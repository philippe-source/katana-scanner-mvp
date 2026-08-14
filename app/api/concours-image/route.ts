// Image d'une carte de la Vitrine (création VALIDÉE), servie comme une vraie image, une par une.
import { kv } from "@vercel/kv";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get("id") || "");
  if (!id) return new Response("", { status: 400 });
  try {
    const r = (await kv.get("concours:" + id)) as Record<string, unknown> | null;
    if (!r || r.state !== "approved") return new Response("", { status: 404 });
    const mi = (r.moodImages as unknown[]) || [];
    const durl = (mi.length ? mi[0] : r.fiche) as string | undefined;
    if (!durl || typeof durl !== "string") return new Response("", { status: 404 });
    const m = /^data:(.+?);base64,(.*)$/.exec(durl);
    if (!m) return new Response("", { status: 404 });
    const buf = Buffer.from(m[2], "base64");
    return new Response(buf, { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=120" } });
  } catch {
    return new Response("", { status: 404 });
  }
}
