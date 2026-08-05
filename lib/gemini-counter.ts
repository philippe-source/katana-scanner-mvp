/**
 * Compteur d'appels Gemini Image (Nano Banana Pro) — stocké dans Vercel KV.
 *
 * À appeler après chaque appel Gemini Image RÉUSSI dans les routes API.
 * Estime le coût cumulé (mois en cours) et le cap restant.
 *
 * Tarifs FACT Google (gemini-3-pro-image-preview) :
 *  - 2K en sortie : ~0.24 USD / image (ce qu'on utilise dans toutes nos apps)
 *  - 1K en sortie : ~0.13 USD / image
 *
 * Cap mensuel actuel : 50 USD (chargé par Philippe — séance S94 du 2026-05-20).
 * Si le cap change → mettre à jour CAP_USD ci-dessous.
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const COST_PER_IMAGE_USD = 0.24; // 2K en sortie, le défaut Mood (fallback legacy)
const COST_FINAL_USD = 0.24;     // Finale = 2K en sortie
const COST_PREVIEW_USD = 0.13;   // Aperçu = 1K en sortie (~2× moins cher)
const CAP_USD = 50;

function todayKey(): string {
  return `gemini:day:${new Date().toISOString().slice(0, 10)}`;
}
function monthKey(): string {
  const now = new Date();
  return `gemini:month:${now.toISOString().slice(0, 7)}`;
}
// Coût cumulé du mois, stocké en CENTES de dollar (permet Aperçu 13c / Finale 24c)
function monthCostKey(): string {
  const now = new Date();
  return `gemini:monthcost:${now.toISOString().slice(0, 7)}`;
}

async function kvCall(path: string): Promise<unknown> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}${path}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function kvIncrBy(key: string, amount: number, expireSeconds?: number): Promise<number | null> {
  const data = await kvCall(`/incrby/${encodeURIComponent(key)}/${amount}`) as { result?: number } | null;
  const value = data?.result ?? null;
  // Première écriture (le total vaut exactement ce qu'on vient d'ajouter) → poser le TTL
  if (value !== null && value === amount && expireSeconds) {
    await kvCall(`/expire/${encodeURIComponent(key)}/${expireSeconds}`);
  }
  return value;
}

async function kvGet(key: string): Promise<number> {
  const data = await kvCall(`/get/${encodeURIComponent(key)}`) as { result?: string | number | null } | null;
  return Number(data?.result || 0);
}

/**
 * Incrémente le compteur d'appels Gemini Image (jour + mois).
 * Silencieux si KV indispo (ne bloque pas la réponse de la route).
 */
export async function incrementGeminiImageCount(): Promise<void> {
  // Rétro-compatible : 1 image en qualité Finale (2K) par défaut.
  await recordGeminiImages(1, "final");
}

/**
 * Enregistre N images générées, au prix correspondant au niveau de qualité.
 *  - qualite === "final" → 2K → 0.24 USD / image
 *  - sinon (Aperçu 1K)   → 0.13 USD / image
 * Additionne le nombre d'images (jour + mois) ET le coût cumulé (en centes).
 * Silencieux si la mémoire est indispo (ne bloque jamais la génération).
 */
export async function recordGeminiImages(count: number = 1, qualite?: string | null): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  if (!count || count < 1) return;
  const unitCents = Math.round((qualite === "final" ? COST_FINAL_USD : COST_PREVIEW_USD) * 100);
  const cents = unitCents * count;
  try {
    await Promise.all([
      kvIncrBy(todayKey(), count, 86400 * 7),
      kvIncrBy(monthKey(), count, 86400 * 70),
      kvIncrBy(monthCostKey(), cents, 86400 * 70),
    ]);
  } catch {
    // Silent fail — le compteur n'est pas critique
  }
}

export type GeminiStats = {
  today: number;
  month: number;
  monthCostUsd: number;
  remainingUsd: number;
  capUsd: number;
  costPerImageUsd: number;
  kvAvailable: boolean;
};

export async function getGeminiStats(): Promise<GeminiStats> {
  if (!KV_URL || !KV_TOKEN) {
    return {
      today: 0, month: 0, monthCostUsd: 0,
      remainingUsd: CAP_USD, capUsd: CAP_USD,
      costPerImageUsd: COST_PER_IMAGE_USD,
      kvAvailable: false,
    };
  }
  const [today, month, costCents] = await Promise.all([kvGet(todayKey()), kvGet(monthKey()), kvGet(monthCostKey())]);
  // Coût réel accumulé (centes → USD). Repli legacy si le mois n'a pas d'accumulateur.
  const monthCostUsd = costCents > 0
    ? Math.round(costCents) / 100
    : Math.round(month * COST_PER_IMAGE_USD * 100) / 100;
  const remainingUsd = Math.round(Math.max(0, CAP_USD - monthCostUsd) * 100) / 100;
  return {
    today,
    month,
    monthCostUsd,
    remainingUsd,
    capUsd: CAP_USD,
    costPerImageUsd: COST_PER_IMAGE_USD,
    kvAvailable: true,
  };
}
