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

// Sous ce nombre de pièces physiques, ce qui est réservé à des commandes en attente est
// déduit du stock disponible : le casier est déjà vide pour la vente suivante.
export const COMMITTED_THRESHOLD = 3;

const MATERIALS_TTL_MS = 10 * 60 * 1000;
const MOVEMENTS_TTL_MS = 10 * 60 * 1000;
const HISTORY_DAYS = 90;

export interface KatanaReassortRow {
  sku: string;
  name: string;
  supplier: string;
  // Stock réellement libre : physique moins ce qui est réservé à des commandes en attente.
  inStock: number;
  physicalStock: number;
  committedStock: number;
  expected: number;
  // Sorties de stock sur les trois fenêtres d'observation du fournisseur
  // (7/30/90 par défaut, 7/15/30 pour Coloral).
  qtyShort: number;
  qtyMedium: number;
  qtyLong: number;
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
  // Sorties par jour d'ancienneté (0 = aujourd'hui … 90). Garder le détail au jour
  // permet de calculer n'importe quelle fenêtre sans relire Katana : Coloral se
  // regarde sur 30 jours, les autres fournisseurs sur 90.
  outByDay: number[];
  // Dernier solde connu par emplacement : le stock actuel en est la somme.
  lastByLocation: Map<number, { date: string; balance: number }>;
}

function sumWindow(s: MovementSummary | undefined, days: number): number {
  if (!s) return 0;
  let total = 0;
  for (let d = 0; d < days && d < s.outByDay.length; d++) total += s.outByDay[d];
  return total;
}

let movementsCache: { at: number; value: Map<number, MovementSummary>; read: number } | null = null;

async function loadMovements(): Promise<{ byVariant: Map<number, MovementSummary>; read: number }> {
  if (movementsCache && Date.now() - movementsCache.at < MOVEMENTS_TTL_MS) {
    return { byVariant: movementsCache.value, read: movementsCache.read };
  }

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const since = new Date(now - HISTORY_DAYS * dayMs).toISOString();

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
      s = { outByDay: new Array(HISTORY_DAYS + 1).fill(0), lastByLocation: new Map() };
      byVariant.set(vid, s);
    }
    const date = mv.movement_date ?? mv.created_at ?? "";
    const prev = s.lastByLocation.get(mv.location_id);
    if (!prev || date > prev.date) {
      s.lastByLocation.set(mv.location_id, { date, balance: Number(mv.balance_after ?? 0) });
    }
    const change = Number(mv.quantity_change ?? 0);
    if (change >= 0) continue; // une entrée n'est pas une sortie
    const t = Date.parse(date);
    const daysAgo = Number.isFinite(t) ? Math.floor((now - t) / dayMs) : HISTORY_DAYS;
    const slot = Math.min(Math.max(daysAgo, 0), HISTORY_DAYS);
    s.outByDay[slot] += -change;
  }

  movementsCache = { at: Date.now(), value: byVariant, read: movements.length };
  return { byVariant, read: movements.length };
}

// ─── Stock des références qui n'ont pas bougé depuis 90 jours ──────────────────

// L'inventaire complet dépasse 175 000 lignes : on ne le balaie jamais. Le filtre
// variant_id accepte plusieurs valeurs, donc on ne demande que ce qui manque.
async function fetchStockFor(
  variantIds: number[]
): Promise<Map<number, { inStock: number; committed: number; expected: number }>> {
  const out = new Map<number, { inStock: number; committed: number; expected: number }>();
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
        const cur = out.get(vid) ?? { inStock: 0, committed: 0, expected: 0 };
        cur.inStock += Number(row.quantity_in_stock ?? 0);
        cur.committed += Number(row.quantity_committed ?? 0);
        cur.expected += Number(row.quantity_expected ?? 0);
        out.set(vid, cur);
      }
    }
  }
  return out;
}

// ─── Réservations récentes (commandes clients non expédiées) ───────────────────
//
// Le chiffre « réservé » de Katana n'est pas fiable : il traîne plus de 15 000
// commandes clients jamais closes, dont de très vieilles. Philippe (08.08.2026) :
// tout ce qui a plus de RESERVATION_MAX_AGE_DAYS jours est à éliminer.
export const RESERVATION_MAX_AGE_DAYS = 50;

// Une matière ne se vend jamais directement : ce qui se vend, c'est le bijou. Katana
// bloque la matière en remontant la recette du produit commandé, mais ne date pas ce
// blocage. On refait donc le trajet en sens inverse : commandes clientes récentes →
// recette du bijou → matière. Le livre des recettes complet dépasse 30 000 lignes, on
// ne le consulte donc QUE pour les matières dont le tiroir est déjà sous le seuil.
let reservationsCache: { at: number; value: Map<number, number> } | null = null;

// Quantités commandées ces 50 derniers jours, par variante de PRODUIT (le bijou).
async function loadRecentProductDemand(): Promise<Map<number, number>> {
  if (reservationsCache && Date.now() - reservationsCache.at < MOVEMENTS_TTL_MS) {
    return reservationsCache.value;
  }
  const since = new Date(Date.now() - RESERVATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const orders = await getAllPages<{
    sales_order_rows?: { variant_id: number; quantity: number | string }[];
  }>(`/v1/sales_orders?status=NOT_SHIPPED&created_at_min=${encodeURIComponent(since)}`);

  const value = new Map<number, number>();
  for (const o of orders) {
    for (const row of o.sales_order_rows ?? []) {
      if (row.variant_id == null) continue;
      value.set(row.variant_id, (value.get(row.variant_id) ?? 0) + Number(row.quantity ?? 0));
    }
  }
  reservationsCache = { at: Date.now(), value };
  return value;
}

// Réservations réelles et datées d'une matière : somme, sur les bijoux qui l'utilisent,
// de ce qui a été commandé ces 50 derniers jours × la quantité prévue par la recette.
// Le filtre par ingrédient est le seul que Katana honore sur les recettes (vérifié) —
// le filtre par produit est ignoré, d'où ce sens de lecture.
// Interroger la recette matière par matière est impossible : Katana n'autorise que
// 60 appels par minute, et 471 matières demanderaient huit minutes. Le livre complet
// tient en ~130 pages (~32 000 lignes), soit environ deux minutes, gardées 10 minutes
// en mémoire et partagées par tous les fournisseurs.
let recipesCache: { at: number; value: Map<number, { productVariantId: number; quantity: number }[]> } | null = null;

async function loadRecipeIndex(): Promise<Map<number, { productVariantId: number; quantity: number }[]>> {
  if (recipesCache && Date.now() - recipesCache.at < MOVEMENTS_TTL_MS) return recipesCache.value;

  const rows = await getAllPages<{
    ingredient_variant_id: number;
    product_variant_id: number;
    quantity: number | string;
  }>("/v1/recipes");

  const value = new Map<number, { productVariantId: number; quantity: number }[]>();
  for (const r of rows) {
    if (r.ingredient_variant_id == null) continue;
    const list = value.get(r.ingredient_variant_id) ?? [];
    list.push({ productVariantId: r.product_variant_id, quantity: Number(r.quantity ?? 0) });
    value.set(r.ingredient_variant_id, list);
  }
  recipesCache = { at: Date.now(), value };
  return value;
}

async function reservationsForMaterials(
  materialVariantIds: number[],
  productDemand: Map<number, number>
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!materialVariantIds.length) return out;

  const index = await loadRecipeIndex();
  for (const id of materialVariantIds) {
    let total = 0;
    for (const { productVariantId, quantity } of index.get(id) ?? []) {
      const ordered = productDemand.get(productVariantId) ?? 0;
      if (ordered > 0) total += ordered * quantity;
    }
    out.set(id, total);
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

// Fenêtres d'observation, en jours : courte / moyenne / longue.
// Coloral se juge sur 30 jours (7 / 15 / 30) : l'aluminium anodisé suit les collections,
// et une histoire de trois mois fait remonter des couleurs qui ne tournent plus.
// Cheminement du 07-08.08.2026 avec Philippe : 90 → 30 (trop sec) → 60 → 30 retenu une
// fois le stock réservé correctement traité, qui changeait la donne.
export const DEFAULT_WINDOWS: [number, number, number] = [7, 30, 90];
export const SHORT_HORIZON_WINDOWS: [number, number, number] = [7, 15, 30];
const COLORAL_SUPPLIER_NAME = "coloral";

export function windowsForSupplier(supplierName: string): [number, number, number] {
  return supplierName.trim().toLowerCase() === COLORAL_SUPPLIER_NAME
    ? SHORT_HORIZON_WINDOWS
    : DEFAULT_WINDOWS;
}

export async function loadReassortDataForSupplier(
  supplierId: number,
  supplierName: string
): Promise<{
  rows: KatanaReassortRow[];
  movementsRead: number;
  rebuiltFromLedger: number;
  lookedUp: number;
  dormantSkipped: number;
  windows: [number, number, number];
}> {
  const windows = windowsForSupplier(supplierName);
  const all = (await loadMaterialVariants()).filter((v) => v.supplierId === supplierId);
  const { byVariant, read } = await loadMovements();

  // On ne garde que les matières qui ont bougé au moins une fois en 90 jours, mais on
  // garde TOUTES leurs tailles : une taille immobile doit rester disponible pour la
  // répartition de gamme Coloral. Demander le stock des 7 000 références endormies
  // d'un gros fournisseur coûtait 275 secondes pour un résultat toujours nul.
  const activeMaterials = new Set(all.filter((v) => byVariant.has(v.variantId)).map((v) => v.materialId));
  const variants = all.filter((v) => activeMaterials.has(v.materialId));

  // Le stock est TOUJOURS lu dans l'inventaire, plus reconstitué depuis le journal des
  // mouvements : le journal donne bien la quantité physique (contrôlé, 40 références sur
  // 40 identiques à Katana) mais ignore la part RÉSERVÉE aux commandes en attente.
  //
  // Cette part réservée n'est déduite que lorsque le tiroir est presque vide — moins de
  // COMMITTED_THRESHOLD pièces physiques (Philippe, 08.08.2026). La déduire partout
  // triplait la commande (1524 → 4631 pièces sur Coloral), ce qui n'a pas de sens quand
  // il reste de la marge ; en revanche sous 3 pièces, ce qui est promis est réellement
  // parti et le casier est vide pour la vente suivante.
  const [stock, incoming, productDemand] = await Promise.all([
    fetchStockFor(variants.map((v) => v.variantId)),
    loadIncoming(supplierId),
    loadRecentProductDemand(),
  ]);

  // Le trajet inverse ne se fait que là où il change quelque chose : les tiroirs déjà
  // sous le seuil. Chez Coloral, 471 références sur 1728.
  const lowStock = variants
    .filter((v) => (stock.get(v.variantId)?.inStock ?? 0) < COMMITTED_THRESHOLD)
    .map((v) => v.variantId);
  const reservations = await reservationsForMaterials(lowStock, productDemand);

  const rows: KatanaReassortRow[] = variants.map((v) => {
    const s = byVariant.get(v.variantId);
    const inv = stock.get(v.variantId);
    const physical = inv?.inStock ?? 0;
    // On n'utilise PAS le « réservé » de l'inventaire : il agrège des commandes
    // clientes jamais closes depuis des années. Seules comptent celles des
    // RESERVATION_MAX_AGE_DAYS derniers jours, retrouvées via la recette.
    const committed = reservations.get(v.variantId) ?? 0;
    const usable = physical < COMMITTED_THRESHOLD ? physical - committed : physical;
    return {
      sku: v.sku,
      name: v.materialName,
      supplier: supplierName,
      inStock: usable,
      physicalStock: physical,
      committedStock: committed,
      expected: incoming.get(v.variantId) ?? inv?.expected ?? 0,
      qtyShort: sumWindow(s, windows[0]),
      qtyMedium: sumWindow(s, windows[1]),
      qtyLong: sumWindow(s, windows[2]),
    };
  });

  return {
    rows,
    movementsRead: read,
    rebuiltFromLedger: 0,
    lookedUp: variants.length,
    dormantSkipped: all.length - variants.length,
    windows,
  };
}
