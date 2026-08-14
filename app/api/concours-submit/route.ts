// Réception publique des créations du concours. Stockage Vercel KV. Aucune auth (formulaire public).
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const INDEX = "concours:index";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const nom = String(body.nom || "").trim();
  const projet = String(body.projet || "").trim();
  const mail = String(body.mail || "").trim();
  if (!nom || !projet || !/.+@.+\..+/.test(mail)) {
    return NextResponse.json({ error: "nom, projet et email valides requis" }, { status: 400 });
  }
  const refs = Array.isArray(body.refs) ? (body.refs as unknown[]).slice(0, 6) : [];
  const id = "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const record = {
    id, date: new Date().toISOString(), state: "pending",
    nom, projet, mail,
    desc: String(body.desc || ""),
    fiche: body.fiche || null,
    refs,
    moodImages: [] as unknown[],
    votes: 0,
  };
  try {
    await kv.set("concours:" + id, record);
    await kv.sadd(INDEX, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
