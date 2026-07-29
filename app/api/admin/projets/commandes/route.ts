import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Rattache les projets de personnalisation à leurs commandes Shopify.
//
// Deux usages :
//  1. GET /api/admin/projets/commandes            → index dessin → commande(s), pour toute la liste
//  2. GET /api/admin/projets/commandes?commande=396238 → recherche directe d'un numéro de commande
//     (fonctionne même si la commande n'est pas dans l'index : lecture directe chez Shopify)

const STORE = process.env.SHOPIFY_STORE!;
const TOKEN = process.env.SHOPIFY_API_TOKEN!;
const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-01";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const CACHE_KEY = "perso:projets:commandes";
const CACHE_TTL_MS = 10 * 60_000;
const MAX_PAGES = 20; // 20 × 100 = 2000 commandes personnalisées max par index

const DESIGN_RE = /(?:design|argent)_\d{10,}_[a-z0-9]+/g;

async function redisGet(key: string): Promise<string | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: "no-store",
  });
  return (await r.json()).result ?? null;
}

async function redisSet(key: string, value: string) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: value,
  });
}

export type CommandeLiee = {
  numero: string;
  orderId: string;
  date: string;
  paiement?: string;
  expedition?: string;
  client?: string;
  email?: string;
  adminUrl: string;
};

type GqlOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string;
  displayFulfillmentStatus?: string;
  customer?: { firstName?: string; lastName?: string; email?: string } | null;
  lineItems: { edges: { node: { customAttributes: { key: string; value: string }[] } }[] };
};

function adminUrl(orderId: string) {
  const num = orderId.split("/").pop();
  return `https://${STORE}/admin/orders/${num}`;
}

function toCommande(o: GqlOrder): CommandeLiee {
  const prenom = o.customer?.firstName ?? "";
  const nom = o.customer?.lastName ?? "";
  return {
    numero: o.name.replace(/^#/, ""),
    orderId: o.id.split("/").pop() ?? "",
    date: o.createdAt,
    paiement: o.displayFinancialStatus ?? undefined,
    expedition: o.displayFulfillmentStatus ?? undefined,
    client: `${prenom} ${nom}`.trim() || undefined,
    email: o.customer?.email ?? undefined,
    adminUrl: adminUrl(o.id),
  };
}

function designIdsFrom(attrs: { key: string; value: string }[]): string[] {
  const out = new Set<string>();
  for (const a of attrs ?? []) {
    for (const m of (a.value ?? "").matchAll(DESIGN_RE)) out.add(m[0]);
  }
  return Array.from(out);
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const d = await r.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors).slice(0, 300));
  return d.data as T;
}

const ORDERS_QUERY = `
query PersoOrders($cursor: String) {
  orders(first: 100, after: $cursor, query: "tag:autoperso", sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id name createdAt displayFinancialStatus displayFulfillmentStatus
      customer { firstName lastName email }
      lineItems(first: 10) { edges { node { customAttributes { key value } } } }
    } }
  }
}`;

type OrdersPage = {
  orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: { node: GqlOrder }[] };
};

// Index dessin → commande(s), reconstruit toutes les 10 minutes
async function buildIndex(): Promise<Record<string, CommandeLiee[]>> {
  const index: Record<string, CommandeLiee[]> = {};
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data: OrdersPage = await gql<OrdersPage>(ORDERS_QUERY, { cursor });

    for (const { node } of data.orders.edges) {
      const attrs = node.lineItems.edges.flatMap((e) => e.node.customAttributes ?? []);
      const ids = designIdsFrom(attrs);
      if (ids.length === 0) continue;
      const cmd = toCommande(node);
      for (const id of ids) {
        if (!index[id]) index[id] = [];
        if (!index[id].some((c) => c.numero === cmd.numero)) index[id].push(cmd);
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  return index;
}

// Recherche directe d'un numéro de commande — marche pour TOUTES les commandes,
// y compris celles qui n'ont pas l'étiquette « autoperso »
async function chercherCommande(numero: string) {
  const clean = numero.replace(/[^\d]/g, "");
  if (!clean) return { trouve: false as const };

  const fields = "id,name,created_at,email,customer,financial_status,fulfillment_status,line_items,note";
  const urls = [
    `https://${STORE}/admin/api/${API_VERSION}/orders.json?status=any&name=${clean}&fields=${fields}&limit=5`,
    `https://${STORE}/admin/api/${API_VERSION}/orders.json?status=any&name=%23${clean}&fields=${fields}&limit=5`,
  ];

  type RestOrder = {
    id: number;
    name: string;
    created_at: string;
    email?: string;
    note?: string;
    financial_status?: string;
    fulfillment_status?: string | null;
    customer?: { first_name?: string; last_name?: string; email?: string };
    line_items?: { title: string; quantity: number; properties?: { name: string; value: string }[] }[];
  };

  let order: RestOrder | undefined;
  for (const url of urls) {
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN }, cache: "no-store" });
    if (!r.ok) continue;
    const { orders } = (await r.json()) as { orders: RestOrder[] };
    order = (orders ?? []).find((o) => o.name.replace(/^#/, "") === clean) ?? orders?.[0];
    if (order) break;
  }

  if (!order) return { trouve: false as const };

  // Les liens de dessin vivent dans les détails de la ligne personnalisée, et en secours dans la note
  const attrs = (order.line_items ?? []).flatMap((li) =>
    (li.properties ?? []).map((p) => ({ key: p.name, value: p.value }))
  );
  const designIds = designIdsFrom([...attrs, { key: "note", value: order.note ?? "" }]);

  const lignes = (order.line_items ?? []).map((li) => ({
    titre: li.title,
    quantite: li.quantity,
    details: (li.properties ?? []).map((p) => ({ nom: p.name, valeur: p.value })),
  }));

  const prenom = order.customer?.first_name ?? "";
  const nom = order.customer?.last_name ?? "";

  return {
    trouve: true as const,
    commande: {
      numero: order.name.replace(/^#/, ""),
      orderId: String(order.id),
      date: order.created_at,
      paiement: order.financial_status ?? undefined,
      expedition: order.fulfillment_status ?? undefined,
      client: `${prenom} ${nom}`.trim() || undefined,
      email: order.customer?.email ?? order.email ?? undefined,
      adminUrl: `https://${STORE}/admin/orders/${order.id}`,
    } satisfies CommandeLiee,
    designIds,
    lignes,
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Auth required" }, { status: 401 });
  if (!STORE || !TOKEN) return NextResponse.json({ error: "Shopify non configuré" }, { status: 503 });

  const params = new URL(req.url).searchParams;
  const numero = params.get("commande");

  try {
    if (numero) return NextResponse.json(await chercherCommande(numero));

    const refresh = params.get("refresh") === "1";
    if (!refresh) {
      const raw = await redisGet(CACHE_KEY);
      if (raw) {
        const { data, ts } = JSON.parse(raw) as { data: Record<string, CommandeLiee[]>; ts: number };
        if (Date.now() - ts < CACHE_TTL_MS) {
          return NextResponse.json({ index: data }, { headers: { "X-Cache": "HIT" } });
        }
      }
    }

    const index = await buildIndex();
    await redisSet(CACHE_KEY, JSON.stringify({ data: index, ts: Date.now() }));
    return NextResponse.json({ index }, { headers: { "X-Cache": "MISS" } });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
