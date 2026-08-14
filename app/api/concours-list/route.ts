// Liste des créations pour l'Espace mood — protégée par CODE (partagé). Renvoie tout sauf les écartées.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

const CODE = "M00d2025*";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { body = {}; }
  if (String(body.code || "") !== CODE) return NextResponse.json({ error: "code" }, { status: 401 });

  try {
    const ids = (await kv.smembers("concours:index")) as string[] | null;
    if (!ids || !ids.length) return NextResponse.json({ items: [] });
    const vals = (await kv.mget(...ids.map((i) => "concours:" + i))) as (Record<string, unknown> | null)[];
    const items = vals
      .filter(Boolean)
      .filter((v) => (v as { state?: string }).state !== "rejected")
      .sort((a, b) => {
        const sa = (a as { state?: string }).state === "pending" ? 0 : 1;
        const sb = (b as { state?: string }).state === "pending" ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return String((b as { date?: string }).date || "").localeCompare(String((a as { date?: string }).date || ""));
      });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
