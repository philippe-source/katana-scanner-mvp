// Carnet des nouveautés — dictionnaire de fabrication Mood.
// Collections + addons (fiches) stockés dans Vercel KV, partagés pour toute l'équipe.
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { auth } from "@/auth";
import { randomUUID } from "crypto";

// Seules ces personnes peuvent créer/modifier ; les autres ne font que consulter.
const EDITORS = new Set(["amila@yourmood.net"]);
const canEdit = (email?: string | null) => !!email && EDITORS.has(email.toLowerCase());

const COLS = "carnet:cols"; // [{id,name,month}]
const colAddons = (id: string) => `carnet:col:${id}`; // [addonId,...]
const addonKey = (id: string) => `carnet:addon:${id}`; // objet fiche

type Collection = { id: string; name: string; month: string; cover?: string; shopify?: string };
type Addon = Record<string, unknown> & { id: string; collectionId: string; nom: string };

async function getCols(): Promise<Collection[]> {
  return ((await kv.get<Collection[]>(COLS)) || []);
}

// GET → { collections:[{...,addons:[fiche]}] }
export async function GET() {
  // Consultation ouverte : tout le monde avec le lien voit le Carnet (aucune connexion requise).
  // La connexion sert seulement à savoir si la personne a le droit de modifier (canEdit).
  const session = await auth().catch(() => null);
  try {
    const cols = await getCols();
    const out = [];
    for (const c of cols) {
      const ids = (await kv.get<string[]>(colAddons(c.id))) || [];
      const addons = (ids.length ? await kv.mget<(Addon | null)[]>(...ids.map(addonKey)) : []).filter(Boolean);
      out.push({ ...c, addons });
    }
    return NextResponse.json({ collections: out, canEdit: canEdit(session?.user?.email) });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}

// POST { action, ... }
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "non connecté" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }
  const action = b.action as string;
  const by = session.user?.email || "";
  if (!canEdit(by)) return NextResponse.json({ error: "lecture seule — seule Amila peut modifier le Carnet" }, { status: 403 });
  try {
    if (action === "createCollection") {
      const c: Collection = { id: randomUUID().slice(0, 8), name: String(b.name || "Sans nom"), month: String(b.month || "") };
      const cols = await getCols();
      cols.unshift(c);
      await kv.set(COLS, cols);
      return NextResponse.json({ ok: true, collection: c });
    }
    if (action === "updateCollection") {
      const cols = await getCols();
      const c = cols.find((x) => x.id === b.id);
      if (!c) return NextResponse.json({ error: "collection introuvable" }, { status: 404 });
      if (b.name !== undefined) c.name = String(b.name);
      if (b.month !== undefined) c.month = String(b.month);
      if (b.cover !== undefined) c.cover = String(b.cover);
      if (b.shopify !== undefined) c.shopify = String(b.shopify);
      await kv.set(COLS, cols);
      return NextResponse.json({ ok: true });
    }
    if (action === "deleteCollection") {
      const cols = (await getCols()).filter((x) => x.id !== b.id);
      const ids = (await kv.get<string[]>(colAddons(String(b.id)))) || [];
      for (const id of ids) await kv.del(addonKey(id));
      await kv.del(colAddons(String(b.id)));
      await kv.set(COLS, cols);
      return NextResponse.json({ ok: true });
    }
    if (action === "createAddon") {
      const colId = String(b.collectionId);
      const addon: Addon = {
        id: randomUUID().slice(0, 8), collectionId: colId, nom: String(b.nom || "Nouvel addon"),
        format: "", matiere: "", couleur: "", finition: "",
        croquis: [], inspi: [], ai: [], photos: [],
        laser: "", realisation: "", mtrl: "", shopify: "",
        _by: by, _at: new Date().toISOString(),
      };
      await kv.set(addonKey(addon.id), addon);
      const ids = (await kv.get<string[]>(colAddons(colId))) || [];
      ids.push(addon.id);
      await kv.set(colAddons(colId), ids);
      return NextResponse.json({ ok: true, addon });
    }
    if (action === "updateAddon") {
      const cur = await kv.get<Addon>(addonKey(String(b.id)));
      if (!cur) return NextResponse.json({ error: "addon introuvable" }, { status: 404 });
      const patch = (b.patch as Record<string, unknown>) || {};
      const next = { ...cur, ...patch, _by: by, _at: new Date().toISOString() };
      await kv.set(addonKey(String(b.id)), next);
      return NextResponse.json({ ok: true, addon: next });
    }
    if (action === "deleteAddon") {
      const cur = await kv.get<Addon>(addonKey(String(b.id)));
      if (cur) {
        const ids = ((await kv.get<string[]>(colAddons(cur.collectionId))) || []).filter((x) => x !== b.id);
        await kv.set(colAddons(cur.collectionId), ids);
        await kv.del(addonKey(String(b.id)));
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action inconnue" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
