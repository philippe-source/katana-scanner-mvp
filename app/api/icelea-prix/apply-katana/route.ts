import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

const KATANA_KEY = process.env.KATANA_API_KEY!;
const KATANA_BASE = "https://api.katanamrp.com";
const SLEEP = (ms: number) => new Promise(r => setTimeout(r, ms));

interface CompareRow {
  variant_id: number; variant_sku: string;
  invoice_price: number; needs_update: boolean;
}

async function patchVariant(variantId: number, price: number) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${KATANA_BASE}/v1/variants/${variantId}`, {
      method: "PATCH",
      headers: {
        Authorization: KATANA_KEY,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ purchase_price: price }),
      cache: "no-store",
    });
    if (res.status === 429) { await SLEEP(2000 * Math.pow(1.6, attempt)); continue; }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Katana PATCH ${variantId}: HTTP ${res.status} — ${txt.slice(0, 100)}`);
    }
    return;
  }
  throw new Error(`Rate-limit dépassé pour variant ${variantId}`);
}

// L'API traite UNE tranche à la fois (envoyée par le client).
// Mesuré le 07.08.2026 : à 10 écritures parallèles, Katana renvoie des 429 en rafale
// et le temps d'attente explose (~3 min pour 150 variants au lieu des ~3s prévues).
// 5 en parallèle : moins de refus, donc moins d'attente, et des tranches de 25 côté
// page → chaque appel reste sous ~30s et le navigateur ne lâche plus la connexion.
const CONCURRENT = 5;
const INTER_BATCH_MS = 150;

export async function POST(req: NextRequest) {
  try {
    const { rows } = (await req.json()) as { rows: CompareRow[] };
    const toUpdate = (rows ?? []).filter(r => r.needs_update);
    if (!toUpdate.length) return NextResponse.json({ updated: 0, errors: 0, errorDetails: [] });

    let updated = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < toUpdate.length; i += CONCURRENT) {
      const batch = toUpdate.slice(i, i + CONCURRENT);
      const results = await Promise.allSettled(
        batch.map(r => patchVariant(r.variant_id, r.invoice_price))
      );
      results.forEach((res, idx) => {
        if (res.status === "fulfilled") {
          updated++;
        } else {
          const r = batch[idx];
          errorDetails.push(`${r?.variant_sku || r?.variant_id}: ${res.reason?.message ?? "erreur"}`);
        }
      });
      if (i + CONCURRENT < toUpdate.length) await SLEEP(INTER_BATCH_MS);
    }

    return NextResponse.json({ updated, errors: errorDetails.length, errorDetails });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
