// Un cœur = une voix, sur une création VALIDÉE. Public (dédup côté client par mémoire du navigateur).
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });
  try {
    const rec = (await kv.get("concours:" + id)) as Record<string, unknown> | null;
    if (!rec || rec.state !== "approved") return NextResponse.json({ ok: false });
    rec.votes = (Number(rec.votes) || 0) + 1;
    await kv.set("concours:" + id, rec);
    return NextResponse.json({ ok: true, votes: rec.votes });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
