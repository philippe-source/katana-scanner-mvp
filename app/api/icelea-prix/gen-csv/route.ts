import { NextRequest, NextResponse } from "next/server";

// Cette étape lit tout le catalogue de la boutique (~10 800 produits, ~44 pages)
// puis résout les SKU côté Katana : impossible de tenir en 60s, d'où le timeout
// observé le 07.08.2026. Plafond relevé + attentes entre pages resserrées.
export const maxDuration = 300;

const KATANA_KEY = process.env.KATANA_API_KEY!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_API_TOKEN!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE!;
const SHOPIFY_API = `https://${SHOPIFY_STORE}/admin/api/2025-01`;
const KATANA_BASE = "https://api.katanamrp.com";
const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms));

async function katanaGet(path: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(`${KATANA_BASE}${path}`, {
      headers: { Authorization: KATANA_KEY, Accept: "application/json" }, cache: "no-store",
    });
    if (res.status === 429) { await SLEEP(2000 * Math.pow(1.6, attempt)); continue; }
    if (!res.ok) throw new Error(`Katana ${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`Katana rate-limit dépassé sur ${path}`);
}

function parseNextLink(h: string | null) {
  return h?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
}

// Reçoit la liste consolidée des product_variant_id impactés + leurs refs,
// résout les SKUs Katana, charge tous les produits Shopify, et retourne le CSV.
// POST { impacted: { pvId: number, refs: string[] }[], filename?: string }
export async function POST(req: NextRequest) {
  try {
    const { impacted, filename } = (await req.json()) as {
      impacted: { pvId: number; refs: string[] }[];
      filename?: string;
    };

    if (!impacted?.length) {
      return NextResponse.json({ message: "Aucun produit impacté trouvé." });
    }

    // Résoudre Katana variant ID → SKU (en parallèle par lots de 10)
    const katanaSkuMap = new Map<number, string>();
    const ids = impacted.map(i => i.pvId);
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const results = await Promise.allSettled(batch.map(id => katanaGet(`/v1/variants/${id}`)));
      results.forEach((res, idx) => {
        if (res.status === "fulfilled" && res.value?.sku) {
          katanaSkuMap.set(batch[idx], res.value.sku);
        }
      });
      if (i + 10 < ids.length) await SLEEP(100);
    }

    // Charger tous les produits Shopify
    const shopifyVariants = new Map<string, { id: number; title: string; productId: number; productTitle: string; price: string }>();
    let url: string | null = `${SHOPIFY_API}/products.json?limit=250&fields=id,title,variants`;
    while (url) {
      const res = await fetch(url, { headers: { "X-Shopify-Access-Token": SHOPIFY_TOKEN }, cache: "no-store" });
      // Ne pas sortir en silence : un arrêt discret ici produisait un CSV
      // incomplet présenté comme complet.
      if (!res.ok) throw new Error(`Shopify ${res.status} — catalogue chargé à ${shopifyVariants.size} variantes`);
      const json = await res.json() as { products: { id: number; title: string; variants: { id: number; sku: string; title: string; price: string }[] }[] };
      for (const p of json.products ?? []) {
        for (const v of p.variants ?? []) {
          if (v.sku) shopifyVariants.set(v.sku, { id: v.id, title: v.title, productId: p.id, productTitle: p.title, price: v.price });
        }
      }
      url = parseNextLink(res.headers.get("link"));
      if (url) await SLEEP(200);
    }

    // Construire le CSV
    const pvToRefs = new Map(impacted.map(i => [i.pvId, i.refs]));
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const headers = ["shopify_product_id","shopify_title","shopify_variant_id","shopify_variant_title","shopify_sku","current_shopify_price","icelea_refs","suggested_new_price"];
    const lines = [headers.join(",")];

    for (const [pvId, refs] of pvToRefs) {
      const sku = katanaSkuMap.get(pvId);
      if (!sku) continue;
      const sv = shopifyVariants.get(sku);
      if (!sv) continue;
      lines.push([
        esc(sv.productId), esc(sv.productTitle), esc(sv.id), esc(sv.title),
        esc(sku), esc(sv.price), esc(refs.join("; ")), esc(""),
      ].join(","));
    }

    if (lines.length <= 1) {
      return NextResponse.json({ message: "Aucun produit Shopify correspondant trouvé." });
    }

    const date = new Date().toISOString().slice(0, 10);
    const fname = filename ?? `icelea-shopify-impact-${date}.csv`;

    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
