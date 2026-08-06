// Onglet « Projet Icelea — Amila » du Carnet.
// Liste des projets demandés à Icelea, protégée par un simple code partagé (pas de login Google).
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const CODE = "M00d2025";
const KEY = "icelea:projets";
const ok = (c?: string | null) => (c || "") === CODE;

type Projet = {
  id: string;
  nom: string;
  image: string;      // image du proto / dessin
  statut: string;     // "" (pas reçu) | recu | correction | annule | sorti
  date_creation: string;   // naissance de l'idée / 1er mail à Icelea (base de l'ancienneté)
  date_premier_mail: string;
  date_sortie: string;
  mails: string;      // échanges de mails (collés/transférés)
  corrections: string[]; // une image par tour de correction (Correction 1, 2, …)
  photo: string;      // photo du produit reçu dans son sachet
  mtrl: string;       // code MTRL
  _at?: string;
};

async function getAll(): Promise<Projet[]> {
  return (await kv.get<Projet[]>(KEY)) || [];
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  if (!ok(code)) return NextResponse.json({ error: "code" }, { status: 401 });
  return NextResponse.json({ projets: await getAll() });
}

export async function POST(request: Request) {
  let b: Record<string, unknown>;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }
  if (!ok(b.code as string)) return NextResponse.json({ error: "code" }, { status: 401 });
  const action = b.action as string;
  const projets = await getAll();

  if (action === "create") {
    const p: Projet = {
      id: randomUUID().slice(0, 8),
      nom: String(b.nom || "Nouveau projet"),
      image: String(b.image || ""),
      statut: "",
      date_creation: "",
      date_premier_mail: "",
      date_sortie: "",
      mails: "",
      corrections: [],
      photo: "",
      mtrl: "",
      _at: new Date().toISOString(),
    };
    projets.unshift(p);
    await kv.set(KEY, projets);
    return NextResponse.json({ ok: true, projet: p });
  }

  if (action === "update") {
    const p = projets.find((x) => x.id === b.id);
    if (!p) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    const patch = (b.patch as Record<string, unknown>) || {};
    for (const k of ["nom", "image", "statut", "date_creation", "date_premier_mail", "date_sortie", "mails", "photo", "mtrl"] as const) {
      if (patch[k] !== undefined) (p as Record<string, unknown>)[k] = String(patch[k]);
    }
    if (Array.isArray(patch.corrections)) (p as Record<string, unknown>).corrections = (patch.corrections as unknown[]).map(String);
    await kv.set(KEY, projets);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    await kv.set(KEY, projets.filter((x) => x.id !== b.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action" }, { status: 400 });
}
