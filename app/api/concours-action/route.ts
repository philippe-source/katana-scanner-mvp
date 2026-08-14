// Valider (publier) ou écarter une création + attacher les images de mood. Protégée par CODE.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const CODE = "M00d2025*";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  if (String(body.code || "") !== CODE) return NextResponse.json({ error: "code" }, { status: 401 });

  const id = String(body.id || "");
  const action = String(body.action || "");
  if (!id) return NextResponse.json({ error: "id manquant" }, { status: 400 });

  try {
    const rec = (await kv.get("concours:" + id)) as Record<string, unknown> | null;
    if (!rec) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    if (action === "approve") {
      rec.state = "approved";
      if (Array.isArray(body.images)) rec.moodImages = (body.images as unknown[]).slice(0, 6);
      await kv.set("concours:" + id, rec);
    } else if (action === "reject") {
      rec.state = "rejected";
      await kv.set("concours:" + id, rec);
    } else {
      return NextResponse.json({ error: "action inconnue" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
