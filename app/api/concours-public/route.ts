// Liste PUBLIQUE des créations VALIDÉES (pour la Vitrine). Ne renvoie pas l'email.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const ids = (await kv.smembers("concours:index")) as string[] | null;
    if (!ids || !ids.length) return NextResponse.json({ items: [] });
    const vals = (await kv.mget(...ids.map((i) => "concours:" + i))) as (Record<string, unknown> | null)[];
    const items = vals
      .filter(Boolean)
      .filter((v) => (v as { state?: string }).state === "approved")
      .map((v) => {
        const r = v as Record<string, unknown>;
        const mi = (r.moodImages as unknown[]) || [];
        return { id: r.id, projet: r.projet, nom: r.nom, image: mi.length ? mi[0] : (r.fiche || null), votes: Number(r.votes) || 0 };
      })
      .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
