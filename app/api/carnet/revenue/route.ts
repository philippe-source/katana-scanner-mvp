// Carnet — combien une collection Shopify a rapporté (depuis le lancement de ses produits).
// Somme du chiffre d'affaires des lignes de commande dont le produit appartient à la collection.
// Les bundles/coffrets portent le prix sur leur propre ligne (composants à 0) → pas de double comptage.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { auth } from "@/auth";

const STORE = process.env.MOOD_SHOPIFY_DOMAIN || process.env.SHOPIFY_STORE || "";
const TOKEN = process.env.SHOPIFY_API_TOKEN || "";
const API = `https://${STORE}/admin/api/2024-10/graphql.json`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function gql(query: string, variables?: Record<string, unknown>) {
  for (let a = 0; a < 7; a++) {
    const r = await fetch(API, { method: "POST", headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    const j = await r.json();
    if (j.errors && JSON.stringify(j.errors).includes("THROTTLED")) { await sleep(2500); continue; }
    return j;
  }
  return null;
}

// Résout la collection depuis un lien (storefront /collections/handle ou admin /collections/123)
async function resolveCollection(url: string): Promise<{ id: string; title: string } | null> {
  const idm = url.match(/collections\/(\d{6,})/);
  if (idm) {
    const j = await gql(`query($id:ID!){collection(id:$id){id title}}`, { id: `gid://shopify/Collection/${idm[1]}` });
    if (j?.data?.collection) return j.data.collection;
  }
  const hm = url.match(/collections\/([a-z0-9-]+)/i);
  if (hm) {
    const j = await gql(`query($h:String!){collectionByHandle(handle:$h){id title}}`, { h: hm[1] });
    if (j?.data?.collectionByHandle) return j.data.collectionByHandle;
  }
  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "non connecté" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const url = String(b.url || "");
  const colKey = b.colId ? `carnet:rev:${b.colId}` : null;
  if (!url) return NextResponse.json({ error: "lien de collection manquant" }, { status: 400 });

  // cache (si pas de refresh demandé)
  if (colKey && !b.refresh) {
    const cached = await kv.get(colKey);
    if (cached) return NextResponse.json({ ...(cached as object), cached: true });
    if (b.cacheOnly) return NextResponse.json({ none: true }); // à l'ouverture : ne pas lancer de gros calcul
  }

  try {
    const col = await resolveCollection(url);
    if (!col) return NextResponse.json({ error: "collection introuvable depuis ce lien" }, { status: 404 });

    // produits de la collection + date de création la plus ancienne + titres
    const prodIds = new Set<string>();
    const titles = new Map<string, string>();
    let minCreated: string | null = null;
    let cursor: string | null = null;
    do {
      const j: any = await gql(`query($id:ID!,$c:String){collection(id:$id){products(first:250,after:$c){pageInfo{hasNextPage endCursor} nodes{id createdAt title}}}}`, { id: col.id, c: cursor });
      const pr = j?.data?.collection?.products;
      if (!pr) break;
      for (const p of pr.nodes) { prodIds.add(p.id); titles.set(p.id, p.title); if (!minCreated || p.createdAt < minCreated) minCreated = p.createdAt; }
      cursor = pr.pageInfo.hasNextPage ? pr.pageInfo.endCursor : null;
      await sleep(120);
    } while (cursor);

    if (prodIds.size === 0) return NextResponse.json({ error: "aucun produit dans cette collection" }, { status: 404 });
    const since = (minCreated || "2018-01-01").slice(0, 10);

    // parcours des commandes depuis la date de lancement
    let total = 0, units = 0, orders = 0;
    const byId = new Map<string, { units: number; total: number }>();
    let oc: string | null = null;
    do {
      const j: any = await gql(`query($q:String!,$c:String){orders(first:100,query:$q,after:$c){pageInfo{hasNextPage endCursor} edges{node{cancelledAt lineItems(first:30){edges{node{quantity originalTotalSet{shopMoney{amount}} discountAllocations{allocatedAmountSet{shopMoney{amount}}} product{id}}}}}}}}`, { q: `created_at:>=${since}`, c: oc });
      const o = j?.data?.orders;
      if (!o) break;
      for (const e of o.edges) {
        if (e.node.cancelledAt) continue; // commande annulée = pas d'argent encaissé
        orders++;
        for (const li of e.node.lineItems.edges) {
          const pid = li.node.product?.id;
          if (pid && prodIds.has(pid)) {
            // argent réellement encaissé = prix de départ MOINS toutes les remises (ligne + code promo de commande)
            const orig = parseFloat(li.node.originalTotalSet?.shopMoney?.amount || "0");
            const alloc = (li.node.discountAllocations || []).reduce((s: number, d: any) => s + parseFloat(d.allocatedAmountSet?.shopMoney?.amount || "0"), 0);
            const amt = orig - alloc;
            total += amt; units += li.node.quantity;
            const cur = byId.get(pid) || { units: 0, total: 0 };
            cur.units += li.node.quantity; cur.total += amt; byId.set(pid, cur);
          }
        }
      }
      oc = o.pageInfo.hasNextPage ? o.pageInfo.endCursor : null;
      await sleep(200);
    } while (oc);

    const byProduct = [...byId.entries()]
      .map(([id, v]) => ({ name: titles.get(id) || "produit", units: v.units, total: Math.round(v.total) }))
      .sort((a, b) => b.total - a.total);
    const result = { title: col.title, total: Math.round(total), units, since, products: prodIds.size, orders, byProduct, at: new Date().toISOString() };
    if (colKey) await kv.set(colKey, result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
