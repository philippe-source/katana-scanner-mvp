// Stock atelier taille par taille pour un addon Icelea « sorti ».
// À partir du code MTRL noté dans la fiche, on retrouve la matière aluminium
// dans l'atelier (Katana) et on renvoie la quantité en réserve pour chaque taille.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CODE = "M00d2025";
const ok = (c?: string | null) => (c || "") === CODE;

const KEY = process.env.KATANA_API_KEY || "";
let BASE = process.env.KATANA_API_URL || "https://api.katanamrp.com";
if (!BASE.endsWith("/v1")) BASE = BASE.replace(/\/$/, "") + "/v1";

const SIZES = [48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function kat(path: string): Promise<{ data?: unknown[] } & Record<string, unknown>> {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(BASE + path, { headers: { Authorization: "Bearer " + KEY } });
    if (r.status === 429) { await sleep(1200 * (a + 1)); continue; }
    try { return await r.json(); } catch { return {}; }
  }
  return {};
}

// À partir du code noté, fabrique les codes possibles en insérant / remplaçant la taille.
function candidates(code: string): string[] {
  const c = code.trim();
  // Une taille (2 chiffres) déjà présente dans le code → on la remplace par chaque taille.
  const m = c.match(/(^|-)(\d{2})(-|$)/);
  if (m && +m[2] >= 44 && +m[2] <= 74) {
    return SIZES.map((s) => c.replace(/(^|-)(\d{2})(-|$)/, `$1${s}$3`));
  }
  // Pas de taille → on l'insère juste avant le dernier morceau (ex. MTRL-ALU-NOIR → MTRL-ALU-52-NOIR).
  const parts = c.split("-");
  if (parts.length >= 2) {
    return SIZES.map((s) => { const p = [...parts]; p.splice(p.length - 1, 0, String(s)); return p.join("-"); });
  }
  return [];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!ok(url.searchParams.get("code"))) return NextResponse.json({ error: "code" }, { status: 401 });
  const mtrl = (url.searchParams.get("mtrl") || "").trim();
  if (!mtrl) return NextResponse.json({ error: "mtrl" }, { status: 400 });
  if (!KEY) return NextResponse.json({ error: "atelier" }, { status: 500 });

  // Une seule matière « aluminium » contient TOUTES les couleurs × toutes les tailles.
  // On ne prend donc QUE les codes exacts de la couleur demandée, une taille à la fois.
  const lignes: { taille: string; sku: string; qty: number }[] = [];
  let found = false;
  for (const sku of candidates(mtrl)) {
    const taille = sku.match(/(^|-)(\d{2})(-|$)/)?.[2] ?? "";
    const rv = await kat("/variants?sku=" + encodeURIComponent(sku));
    const v = (rv.data as Array<{ id: number }> | undefined)?.[0];
    if (!v?.id) { await sleep(100); continue; }
    found = true;
    const inv = await kat("/inventory?variant_id=" + v.id);
    const rows = (inv.data as Array<{ quantity_in_stock?: string }> | undefined) || [];
    const qty = Math.max(0, Math.round(rows.reduce((s, r) => s + (parseFloat(r.quantity_in_stock || "0") || 0), 0)));
    lignes.push({ taille, sku, qty });
    await sleep(100);
  }
  if (!found) return NextResponse.json({ found: false, lignes: [] });
  lignes.sort((a, b) => (parseInt(a.taille) || 0) - (parseInt(b.taille) || 0));
  return NextResponse.json({ found: true, lignes });
}
