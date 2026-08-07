// ─── Réassort : lecture directe dans Katana (remplace le dépôt de 3 fichiers) ───
//
// Décidé avec Philippe le 07.08.2026. L'ancien parcours demandait trois exports
// manuels (7 / 30 / 90 jours). Preuve du problème : ses exports Coloral ne
// contenaient que 419 références là où Katana en connaît 1758, et les familles
// 2/3 (704 pièces sorties sur 90 jours) et alu 7,1 (239 pièces) en étaient
// totalement absentes — donc jamais réassorties, sans que personne le voie.
//
// Ce que l'on lit ici, c'est ce qui est SORTI DU STOCK, pas ce qui a été VENDU.
// Les deux diffèrent (alu 2,4 sur 90 jours : 910 vendus, 1386 sortis) : l'écart
// est l'atelier, la casse et les corrections de comptage. C'est bien la sortie de
// stock qui vide le tiroir, donc c'est elle qui commande le réassort.
//
// Le stock actuel est reconstitué depuis le solde que chaque mouvement laisse
// derrière lui — contrôlé contre l'export de Philippe : 348 références sur 419
// au chiffre près, les écarts étant des sorties postérieures à son export.
// Les références sans aucun mouvement sont interrogées une par une, par paquets.

const BASE = "https://api.katanamrp.com";
const KEY = process.env.KATANA_API_KEY!;

const MATERIALS_TTL_MS = 10 * 60 * 1000;
const MOVEMENTS_TTL_MS = 10 * 60 * 1000;
const HISTORY_DAYS = 90;

export interface KatanaReassortRow {
  sku: string;
  name: string;
  supplier: string;
  inStock: number;
  expected: number;
  qty7: number;
  qty30: number;
  qty90: number;
}

async function get(path: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: KEY, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const wait = reset && reset > Date.now() ? Math.min(reset - Date.now(), 15000) : 2000 * Math.pow(1.6, attempt);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Katana ${res.status} sur ${path}`);
    return (await res.json()) as Record<string, unknown>;
  }
  throw new Error(`Katana : limite de cadence dépassée sur ${path}`);
}

async function getAllPages<T>(path: string, limit = 250): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await get(`${path}${sep}limit=${limit}&page=${page}`);
    const batch = (data.data ?? []) as T[];
    out.push(...batch);
    if (batch.length < limit) break;
    page++;
  }
  return out;
}

// ─── Catalogue matières (toutes, avec leur fournisseur par défaut) ──────────────

interface MaterialVariant {
  variantId: number;
  materialId: number;
  sku: string;
  materialName: string;
  supplierId: number | null;
}

let materialsCache: { at: number; value: MaterialVariant[] } | null = null;

async function loadMaterialVariants(): Promise<MaterialVariant[]> {
  if (materialsCache && Date.now() - materialsCache.at < MATERIALS_TTL_MS) return materialsCache.value;

  const materials = await getAllPages<{
    id: number;
    name?: string;
    default_supplier_id?: number | null;
    variants?: { id: number; sku?: string | null }[];
  }>("/v1/materials");

  const value: MaterialVariant[] = [];
  for (const m of materials) {
    for (const v of m.variants ?? []) {
      if (!v.sku) continue;
      value.push({
        variantId: v.id,
        materialId: m.id,
        sku: v.sku,
        materialName: m.name ?? "",
        supplierId: m.default_supplier_id ?? null,
      });
    }
  }
  materialsCache = { at: Date.now(), value };
  return value;
}

// ─── Mouvements de stock des 90 derniers jours ─────────────────────────────────

interface MovementSummary {
  qty7: number;
  qty30: number;
  qty90: number;
  // Dernier solde connu par emplacement : le stock actuel en est la somme.
  lastByLocation: Map<number, { date: string; balance: number }>;
}

let movementsCache: { at: number; value: Map<number, MovementSummary>; read: number } | null = null;

async function loadMovements(): Promise<{ byVariant: Map<number, MovementSummary>; read: number }> {
  if (movementsCache && Date.now() - movementsCache.at < MOVEMENTS_TTL_MS) {
    return { byVariant: movementsCache.value, read: movementsCache.read };
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const since = new Date(now - HISTORY_DAYS * dayMs).toISOString();
  const cut7 = new Date(now - 7 * dayMs).toISOString();
  const cut30 = new Date(now - 30 * dayMs).toISOString();

  const movements = await getAllPages<{
    variant_id: number;
    location_id: number;
    quantity_change: number | string;
    balance_after: number | string;
    movement_date?: string;
    created_at?: string;
  }>(`/v1/inventory_movements?created_at_min=${encodeURIComponent(since)}`);

  const byVariant = new Map<number, MovementSummary>();
  for (const mv of movements) {
    const vid = mv.variant_id;
    if (vid == null) continue;
    let s = byVariant.get(vid);
    if (!s) {
      s = { qty7: 0, qty30: 0, qty90: 0, lastByLocation: new Map() };
      byVariant.set(vid, s);
    }
    const date = mv.movement_date ?? mv.created_at ?? "";
    const prev = s.lastByLocation.get(mv.location_id);
    if (!prev || date > prev.date) {
      s.lastByLocation.set(mv.location_id, { date, balance: Number(mv.balance_after ?? 0) });
    }
    const change = Number(mv.quantity_change ?? 0);
    if (change >= 0) continue; // une entrée n'est pas une sortie
    const out = -change;
    s.qty90 += out;
    if (date >= cut30) s.qty30 += out;
    if (date >= cut7) s.qty7 += out;
  }

  movementsCache = { at: Date.now(), value: byVariant, read: movements.length };
  return { byVariant, read: movements.length };
}

// ─── Stock des références qui n'ont pas bougé depuis 90 jours ──────────────────

// L'inventaire complet dépasse 175 000 lignes : on ne le balaie jamais. Le filtre
// variant_id accepte plusieurs valeurs, donc on ne demande que ce qui manque.
async function fetchStockFor(variantIds: number[]): Promise<Map<number, { inStock: number; expected: number }>> {
  const out = new Map<number, { inStock: number; expected: number }>();
  const BATCH = 40; // 40 références × 5 emplacements = 200 lignes, sous la limite de 250
  const CONCURRENT = 4; // Katana = 60 appels/minute, on reste sous la barre

  const batches: number[][] = [];
  for (let i = 0; i < variantIds.length; i += BATCH) batches.push(variantIds.slice(i, i + BATCH));

  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const slice = batches.slice(i, i + CONCURRENT);
    const results = await Promise.all(
      slice.map((batch) => get(`/v1/inventory?limit=250&${batch.map((id) => `variant_id=${id}`).join("&")}`))
    );
    for (const data of results) {
      for (const row of (data.data ?? []) as Record<string, unknown>[]) {
        const vid = Number(row.variant_id);
        const cur = out.get(vid) ?? { inStock: 0, expected: 0 };
        cur.inStock += Number(row.quantity_in_stock ?? 0);
        cur.expected += Number(row.quantity_expected ?? 0);
        out.set(vid, cur);
      }
    }
  }
  return out;
}

// ─── Commandes fournisseur en cours (pour ne pas commander deux fois) ──────────

async function loadIncoming(supplierId: number): Promise<Map<number, number>> {
  const incoming = new Map<number, number>();
  for (const status of ["NOT_RECEIVED", "PARTIALLY_RECEIVED"]) {
    const pos = await getAllPages<{
      purchase_order_rows?: { variant_id: number; quantity: number | string; received_date?: string | null }[];
    }>(`/v1/purchase_orders?supplier_id=${supplierId}&status=${status}`, 100);
    for (const po of pos) {
      for (const row of po.purchase_order_rows ?? []) {
        if (row.received_date) continue; // ligne déjà reçue
        incoming.set(row.variant_id, (incoming.get(row.variant_id) ?? 0) + Number(row.quantity ?? 0));
      }
    }
  }
  return incoming;
}

// ─── Liste des fournisseurs qui ont réellement des matières ────────────────────

// Volontairement SANS compter les références de chaque fournisseur : ce comptage
// obligeait à lire tout le catalogue matières (~60s) avant que la liste s'affiche,
// et la liste restait grisée pendant tout ce temps. Un fournisseur sans matière est
// signalé au chargement, ce qui suffit.
export async function listReassortSuppliers(): Promise<{ id: number; name: string }[]> {
  const suppliers = await getAllPages<{ id: number; name?: string }>("/v1/suppliers");
  return suppliers
    .map((s) => ({ id: s.id, name: s.name ?? `#${s.id}` }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// ─── Point d'entrée : les données de réassort d'un fournisseur ─────────────────

export async function loadReassortDataForSupplier(
  supplierId: number,
  supplierName: string
): Promise<{
  rows: KatanaReassortRow[];
  movementsRead: number;
  rebuiltFromLedger: number;
  lookedUp: number;
  dormantSkipped: number;
}> {
  const all = (await loadMaterialVariants()).filter((v) => v.supplierId === supplierId);
  const { byVariant, read } = await loadMovements();

  // On ne garde que les matières qui ont bougé au moins une fois en 90 jours, mais on
  // garde TOUTES leurs tailles : une taille immobile doit rester disponible pour la
  // répartition de gamme Coloral. Demander le stock des 7 000 références endormies
  // d'un gros fournisseur coûtait 275 secondes pour un résultat toujours nul.
  const activeMaterials = new Set(all.filter((v) => byVariant.has(v.variantId)).map((v) => v.materialId));
  const variants = all.filter((v) => activeMaterials.has(v.materialId));

  const missing = variants.filter((v) => !byVariant.has(v.variantId)).map((v) => v.variantId);
  const [fetched, incoming] = await Promise.all([fetchStockFor(missing), loadIncoming(supplierId)]);

  const rows: KatanaReassortRow[] = variants.map((v) => {
    const s = byVariant.get(v.variantId);
    let inStock: number;
    if (s) {
      let total = 0;
      for (const { balance } of s.lastByLocation.values()) total += balance;
      inStock = total;
    } else {
      inStock = fetched.get(v.variantId)?.inStock ?? 0;
    }
    return {
      sku: v.sku,
      name: v.materialName,
      supplier: supplierName,
      inStock,
      expected: incoming.get(v.variantId) ?? fetched.get(v.variantId)?.expected ?? 0,
      qty7: s?.qty7 ?? 0,
      qty30: s?.qty30 ?? 0,
      qty90: s?.qty90 ?? 0,
    };
  });

  return {
    rows,
    movementsRead: read,
    rebuiltFromLedger: variants.length - missing.length,
    lookedUp: missing.length,
    dormantSkipped: all.length - variants.length,
  };
}
