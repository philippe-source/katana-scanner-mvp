// Liste PUBLIQUE des créations VALIDÉES (Vitrine). Infos légères seulement ; l'image de chaque carte
// se charge séparément via /api/concours-image (pour ne jamais dépasser la taille max).
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  try {
    const ids = (await kv.smembers("concours:index")) as string[] | null;
    if (!ids || !ids.length) return NextResponse.json({ items: [] });
    const vals = (await Promise.all(ids.map((i) => kv.get("concours:" + i)))) as (Record<string, unknown> | null)[];
    const items = vals
      .filter(Boolean)
      .filter((v) => (v as { state?: string }).state === "approved")
      .map((v) => {
        const r = v as Record<string, unknown>;
        const mi = (r.moodImages as unknown[]) || [];
        return { id: r.id, projet: r.projet, nom: r.nom, votes: Number(r.votes) || 0, hasImage: !!(mi.length || r.fiche), v: r.updatedAt || r.date };
      })
      .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
