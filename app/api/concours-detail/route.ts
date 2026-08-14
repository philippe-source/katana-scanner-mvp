// Détail d'UNE création (avec ses images) pour l'Espace mood — protégé par CODE. Un seul enregistrement à la fois.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

function okCode(v: unknown) {
  return String(v || "").trim().toLowerCase().replace(/\*+$/, "") === "m00d2025";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  if (!okCode(body.code)) return NextResponse.json({ error: "code" }, { status: 401 });
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  try {
    const r = (await kv.get("concours:" + id)) as Record<string, unknown> | null;
    if (!r) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json({
      id: r.id, projet: r.projet, nom: r.nom, mail: r.mail, desc: r.desc || "", state: r.state,
      fiche: r.fiche || null, refs: r.refs || [], moodImages: r.moodImages || [],
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
