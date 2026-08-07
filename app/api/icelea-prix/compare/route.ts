import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const KATANA_KEY = process.env.KATANA_API_KEY!;
const KATANA_BASE = "https://api.katanamrp.com";
const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms));
const CACHE_TTL_MS = 5 * 60 * 1000;

interface InvoiceItem { ref: string; size_range: string; price: number }
interface CompareRow {
  ref: string; size_range: string;
  variant_id: number; variant_sku: string; variant_size: number | null;
  material_id: number; material_name: string;
  current_price: number; invoice_price: number;
  delta: number | null; needs_update: boolean;
}

async function katanaGet(path: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${KATANA_BASE}${path}`, {
      headers: { Authorization: KATANA_KEY, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) { await SLEEP(2000 * Math.pow(1.6, attempt)); continue; }
    if (!res.ok) throw new Error(`Katana ${res.status} ${path}`);
    return res.json();
  }
  throw new Error(`Katana rate-limit dépassé sur ${path}`);
}

type IceleaMaterial = { id: number; name: string; variants: Record<string, unknown>[] };

// Parcourir les variantes une par une (/v1/variants?type=material) demande ~61 pages
// pour 15 000 lignes : impossible dans le temps imparti. Le catalogue des matières
// tient en 6 pages et Katana renvoie les variantes de chaque matière dans la réponse.
let cache: { at: number; materials: IceleaMaterial[] } | null = null;

async function loadIceleaMaterials(): Promise<IceleaMaterial[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.materials;

  const rawMaterials: { id: number; variants?: Record<string, unknown>[] }[] = [];
  let page = 1;
  while (true) {
    const data = await katanaGet(`/v1/materials?limit=250&page=${page}`);
    const batch: { id: number; variants?: Record<string, unknown>[] }[] = data.data ?? [];
    if (!batch.length) break;
    rawMaterials.push(...batch);
    if (batch.length < 250) break;
    page++;
    await SLEEP(200);
  }

  // Keep only Icelea SKUs: MTRL-MD-XX-NNN*
  const byMatId: Record<number, IceleaMaterial> = {};
  for (const mat of rawMaterials) {
    for (const v of mat.variants ?? []) {
      if (typeof v.sku !== "string" || !/^MTRL-MD-[A-Z]{2}-\d+/.test(v.sku)) continue;
      const refMatch = v.sku.match(/MTRL-(MD-[A-Z]{2}-\d+)/);
      if (!refMatch) continue;
      const mid = (v.material_id as number) ?? mat.id;
      if (!byMatId[mid]) byMatId[mid] = { id: mid, name: refMatch[1], variants: [] };
      byMatId[mid].variants.push(v);
    }
  }

  const materials = Object.values(byMatId);
  cache = { at: Date.now(), materials };
  return materials;
}

function parseSizeRange(s: string): number[] | null {
  if (!s || s === "none") return null;
  const m = s.match(/^(\d+)-(\d+)$/);
  if (!m) return [];
  const sizes: number[] = [];
  for (let i = parseInt(m[1]); i <= parseInt(m[2]); i += 2) sizes.push(i);
  return sizes;
}

export async function POST(req: NextRequest) {
  try {
    const { items } = (await req.json()) as { items: InvoiceItem[] };
    if (!items?.length) return NextResponse.json({ error: "items vide" }, { status: 400 });

    const materials = await loadIceleaMaterials();

    const matsByRef: Record<string, typeof materials> = {};
    for (const mat of materials) {
      const ref = mat.name.match(/MD-[A-Z]{2}-\d+/)?.[0];
      if (!ref) continue;
      (matsByRef[ref] ??= []).push(mat);
    }

    const rows: CompareRow[] = [];
    const notFound: string[] = [];

    for (const item of items) {
      const mats = matsByRef[item.ref] ?? [];
      if (!mats.length) { notFound.push(item.ref); continue; }

      const targetSizes = parseSizeRange(item.size_range);

      for (const mat of mats) {
        for (const v of mat.variants) {
          const sizeCfg = (v.config_attributes as { config_name: string; config_value: string }[])?.find(c => c.config_name === "Taille");
          const varSize = sizeCfg ? parseInt(sizeCfg.config_value) : null;

          const sizeMatch = targetSizes === null
            ? varSize === null
            : Array.isArray(targetSizes) && (targetSizes.length === 0 || targetSizes.includes(varSize ?? -1));

          if (!sizeMatch) continue;

          const cur = Number(v.purchase_price) || 0;
          const delta = cur > 0 ? (item.price - cur) / cur : null;

          rows.push({
            ref: item.ref,
            size_range: item.size_range,
            variant_id: v.id as number,
            variant_sku: (v.sku as string) ?? "",
            variant_size: varSize,
            material_id: mat.id,
            material_name: mat.name,
            current_price: cur,
            invoice_price: item.price,
            delta,
            needs_update: Math.abs(item.price - cur) >= 0.01,
          });
        }
      }
    }

    const toUpdate = rows.filter(r => r.needs_update).length;
    const unchanged = rows.length - toUpdate;

    return NextResponse.json({ rows, toUpdate, unchanged, notFound, totalMaterials: materials.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
