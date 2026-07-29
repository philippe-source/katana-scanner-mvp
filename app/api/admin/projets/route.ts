import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Liste TOUS les projets de personnalisation (aluminium + argent), depuis le début,
// qu'ils soient encore en devis, déjà commandés, ou restés en brouillon.
// Complète /api/admin/devis qui ne montre que les devis en cours des 30 derniers jours.

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const CACHE_KEY = "perso:projets:list";
const CACHE_TTL_MS = 60_000;
const MAX_KEYS = 8000;

async function redisCmd(...args: (string | number)[]) {
  const r = await fetch(REDIS_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args.map(String)),
    cache: "no-store",
  });
  return r.json();
}

// SCAN plutôt que KEYS : ne bloque pas le stockage même avec des milliers de clés
async function scanKeys(pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  do {
    const resp = await redisCmd("SCAN", cursor, "MATCH", pattern, "COUNT", 500);
    const res = resp.result as [string, string[]] | undefined;
    if (!res) break;
    cursor = res[0];
    out.push(...(res[1] ?? []));
    if (out.length >= MAX_KEYS) break;
  } while (cursor !== "0");
  return Array.from(new Set(out));
}

async function mget(keys: string[]): Promise<(string | null)[]> {
  if (keys.length === 0) return [];
  const out: (string | null)[] = [];
  // Par paquets de 200 pour rester sous la limite de taille de requête
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const resp = await redisCmd("MGET", ...chunk);
    out.push(...((resp.result as (string | null)[]) ?? chunk.map(() => null)));
  }
  return out;
}

type Fichier = { label: string; url: string; filename: string };

export type Projet = {
  designId: string;
  matiere: "alu" | "argent";
  date: string;
  prenom?: string;
  email?: string;
  tel?: string;
  message?: string;
  format?: string;
  couleurNom?: string;
  finitionNom?: string;
  taille?: string;
  gravure?: string;
  nbElements?: number;
  pierresCount?: number;
  pierresTotal?: number;
  prix?: number;
  skuComplet?: string;
  cartUrl?: string;
  apercuUrl: string;
  fichiers: Fichier[];
  source: "demande" | "brouillon";
};

// Le nom du dessin porte sa date de création : design_1748000000000_ab12cd
function dateFromDesignId(id: string): string {
  const m = id.match(/^(?:design|argent)_(\d{10,})_/);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return "";
  return new Date(n).toISOString();
}

function safeName(s?: string) {
  return (s || "projet").replace(/[^\w\-]+/g, "_").slice(0, 40);
}

function projetAlu(designId: string, d: Record<string, unknown> | null): Projet {
  const prenom = (d?.prenom as string) || "";
  return {
    designId,
    matiere: "alu",
    date: (d?.date as string) || dateFromDesignId(designId),
    prenom,
    email: d?.email as string,
    tel: d?.tel as string,
    message: d?.message as string,
    format: (d?.format as string) || undefined,
    couleurNom: (d?.couleurNom as string) || (d?.couleur as string),
    taille: d?.taille as string,
    nbElements: d?.nbElements as number,
    prix: d?.prix as number,
    skuComplet: d?.skuComplet as string,
    cartUrl: d?.cartUrl as string,
    apercuUrl: `/api/design/${designId}`,
    fichiers: [
      {
        label: "Dessin (SVG)",
        url: `/api/design/${designId}`,
        filename: `${safeName(prenom)}_${designId}.svg`,
      },
    ],
    source: d ? "demande" : "brouillon",
  };
}

function projetArgent(designId: string, d: Record<string, unknown> | null): Projet {
  const prenom = (d?.prenom as string) || "";
  return {
    designId,
    matiere: "argent",
    date: (d?.date as string) || dateFromDesignId(designId),
    prenom,
    email: d?.email as string,
    tel: d?.tel as string,
    message: d?.message as string,
    format: (d?.format as string) || undefined,
    finitionNom: (d?.finitionNom as string) || (d?.finition as string),
    taille: d?.taille as string,
    gravure: d?.gravure as string,
    nbElements: d?.nbElements as number,
    pierresCount: d?.pierresCount as number,
    pierresTotal: d?.pierresTotal as number,
    prix: d?.prix as number,
    skuComplet: d?.skuComplet as string,
    cartUrl: d?.cartUrl as string,
    apercuUrl: `/api/design-argent/${designId}/complet`,
    fichiers: [
      {
        label: "Complet",
        url: `/api/design-argent/${designId}/complet`,
        filename: `${safeName(prenom)}_argent_complet.svg`,
      },
      {
        label: "Gravure",
        url: `/api/design-argent/${designId}/gravure`,
        filename: `${safeName(prenom)}_argent_gravure.svg`,
      },
      {
        label: "Plan sertissage",
        url: `/api/design-argent/${designId}/plan`,
        filename: `${safeName(prenom)}_argent_plan-sertissage.svg`,
      },
    ],
    source: d ? "demande" : "brouillon",
  };
}

function parse(v: string | null): Record<string, unknown> | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Auth required" }, { status: 401 });
  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ error: "Storage non configuré" }, { status: 503 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!refresh) {
    const cached = parse((await redisCmd("GET", CACHE_KEY)).result as string | null);
    if (cached && Date.now() - (cached.ts as number) < CACHE_TTL_MS) {
      return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  }

  try {
    const [cartAluKeys, cartArgentKeys, designAluKeys, designArgentKeys] = await Promise.all([
      scanKeys("perso:cart:*"),
      scanKeys("perso:argent:cart:*"),
      scanKeys("perso:design:*"),
      scanKeys("perso:argent:design:*:complet"),
    ]);

    const [cartAluVals, cartArgentVals] = await Promise.all([
      mget(cartAluKeys),
      mget(cartArgentKeys),
    ]);

    const projets: Projet[] = [];
    const vus = new Set<string>();

    cartAluKeys.forEach((k, i) => {
      const designId = k.replace(/^perso:cart:/, "");
      projets.push(projetAlu(designId, parse(cartAluVals[i])));
      vus.add(designId);
    });

    cartArgentKeys.forEach((k, i) => {
      const designId = k.replace(/^perso:argent:cart:/, "");
      projets.push(projetArgent(designId, parse(cartArgentVals[i])));
      vus.add(designId);
    });

    // Dessins sans demande enregistrée (essai abandonné, ou envoi de panier qui a échoué)
    for (const k of designAluKeys) {
      const designId = k.replace(/^perso:design:/, "");
      if (!designId.startsWith("design_") || vus.has(designId)) continue;
      projets.push(projetAlu(designId, null));
      vus.add(designId);
    }
    for (const k of designArgentKeys) {
      const designId = k.replace(/^perso:argent:design:/, "").replace(/:complet$/, "");
      if (!designId.startsWith("argent_") || vus.has(designId)) continue;
      projets.push(projetArgent(designId, null));
      vus.add(designId);
    }

    projets.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    const result = {
      projets,
      total: projets.length,
      totalAlu: projets.filter((p) => p.matiere === "alu").length,
      totalArgent: projets.filter((p) => p.matiere === "argent").length,
      totalBrouillons: projets.filter((p) => p.source === "brouillon").length,
    };

    await redisCmd("SET", CACHE_KEY, JSON.stringify({ data: result, ts: Date.now() }));

    return NextResponse.json(result, { headers: { "X-Cache": "MISS" } });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
