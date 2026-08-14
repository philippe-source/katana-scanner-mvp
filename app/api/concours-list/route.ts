// Liste des créations pour l'Espace mood — protégée par CODE. Renvoie SEULEMENT les infos légères
// (pas les images), pour ne jamais dépasser la taille max de lecture. Les images se chargent au détail.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

function okCode(v: unknown) {
  return String(v || "").trim().toLowerCase().replace(/\*+$/, "") === "m00d2025";
}
function meta(r: Record<string, unknown>) {
  const refs = (r.refs as unknown[]) || [];
  const mi = (r.moodImages as unknown[]) || [];
  return {
    id: r.id, date: r.date, state: r.state, nom: r.nom, projet: r.projet, mail: r.mail,
    desc: r.desc || "", hasFiche: !!r.fiche, refsCount: refs.length, hasMood: mi.length > 0, votes: Number(r.votes) || 0,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  if (!okCode(body.code)) return NextResponse.json({ error: "code" }, { status: 401 });

  try {
    const ids = (await kv.smembers("concours:index")) as string[] | null;
    if (!ids || !ids.length) return NextResponse.json({ items: [] });
    const vals = (await Promise.all(ids.map((i) => kv.get("concours:" + i)))) as (Record<string, unknown> | null)[];
    const items = vals
      .filter(Boolean)
      .filter((v) => (v as { state?: string }).state !== "rejected")
      .map((v) => meta(v as Record<string, unknown>))
      .sort((a, b) => {
        const sa = a.state === "pending" ? 0 : 1;
        const sb = b.state === "pending" ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ items: [], error: String((e as Error)?.message || e) });
  }
}
