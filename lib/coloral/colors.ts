// ─── Correspondances de couleurs Coloral (source unique) ────────────────────────
// Le nom de couleur dans Katana (fin du SKU, ex. "ROSEP") ne correspond pas toujours
// au libellé de la colonne dans le fichier de commande Coloral (ex. "Rose Pastel").
// Ce module fait le pont, et sert à la fois à l'export .xlsx (lib/coloral/order.ts)
// et à la recommandation de réassort (app/reassort/page.tsx).
//
// Régénérer COLORAL_FILE_COLORS avec `node scripts/scan-coloral-colors.mjs` si le
// gabarit fournisseur embarqué (template-b64.ts) change.

// Normalise une couleur pour comparaison : minuscules, sans accents, sans code Pantone
// (938C, 2757C…), sans contenu entre parenthèses, sans chiffres ni ponctuation.
export function normColor(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/p?\d{2,4}\s*c\b/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Le gabarit fournisseur écrit une même couleur de plusieurs façons selon la feuille.
// Confirmé Philippe :
//   - "lila" (lila 2071C) / "lila cashmer" / "lila caschmere" / "Lila Cashmere" = lila cashmere
//   - sur la feuille ALU (7.1mm), la colonne "Jaune" est en réalité le jaune chaud
// → on ramène ces graphies à une seule couleur.
export function canonFileColor(n: string): string {
  if (n === "lila" || n === "lila cashmer" || n === "lila caschmere") return "lila cashmere";
  if (n === "jaune") return "jaune chaud";
  return n;
}

// Nom Katana (normalisé) → nom fichier Coloral (normalisé). Casse ignorée (normColor).
// PRIORITAIRE sur une correspondance directe : ex. Katana "JAUNE" vise la colonne
// "Jaune Chaud", pas la colonne "Jaune" qui existe aussi dans le fichier.
export const COLORAL_COLOR_ALIASES: Record<string, string> = {
  rosep: "rose pastel",
  jaunechaud: "jaune chaud",
  jaunep: "jaune clair", // Katana JAUNEP = "Jaune clair" dans le fichier (≠ jaune pastel)
  lagonbleu: "bleu lagon",
  // "jaune" (Katana) = jaune chaud : géré par canonFileColor (colonne "Jaune" de la feuille ALU).
  anth: "anthracite",
  bleuviolet: "bleu violet",
  lilacashmere: "lila cashmere",
  lilas: "lila cashmere",
  // "lila" (Katana) et "lila 2071C" (fichier) = lila cashmere : géré par canonFileColor.
  // Abréviations propres aux anneaux 2/3 (confirmé Philippe le 07.08.2026). Sans elles,
  // ces deux couleurs disparaissaient de toute commande Coloral sans aucun signal.
  lil: "lila", // "lila" devient "lila cashmere" via canonFileColor
  bel: "belinda",
  bp: "bleu pastel",
  bleupastel: "bleu pastel",
  vertpastel: "vert pastel",
  jaunepastel: "jaune pastel",
};

// Résout une couleur Katana vers le nom normalisé attendu dans le fichier (alias d'abord).
export function resolveColoralColor(rawColor: string): string {
  const n = canonFileColor(normColor(rawColor));
  const aliased = COLORAL_COLOR_ALIASES[n];
  return aliased ? canonFileColor(aliased) : n;
}

// Couleurs réellement présentes dans le gabarit Coloral, par type d'anneau (normalisées,
// graphies du fichier unifiées). Généré depuis template-b64.ts — voir scripts/scan-coloral-colors.mjs.
export const COLORAL_FILE_COLORS: Record<string, ReadonlySet<string>> = {
  // anneaux 7.1 mm  (LILA CASCHMERE = lila cashmere ; colonne "Jaune" = jaune chaud)
  ALU: new Set([
    "abricot", "anthracite", "aubergine", "belinda", "bleu pastel", "bleu violet", "brun",
    "corail", "emeraude", "gris", "jaune chaud", "jaune pastel", "lila cashmere", "marine",
    "menthe", "myrtille", "noir", "noisette", "ocre", "peche", "petrole", "pourpre",
    "rose pastel", "rouge", "taupe", "turquoise", "vert", "vert pastel",
  ]),
  // anneaux 4.8mm  (lila 2071C = lila cashmere)
  "23ALU": new Set([
    "abricot", "anthracite", "aubergine", "belinda", "bleu pastel", "caramel", "corail",
    "emeraude", "jaune chaud", "jaune clair", "kaki", "lila cashmere", "marine", "myrtille",
    "noir", "noisette", "ocre", "orange", "peche", "pistache", "rose pastel", "rouge", "rubis",
    "taupe", "turquoise", "vert mood", "vert pastel",
  ]),
  // mediums 2,4mm  (lila cashmer = lila cashmere)
  MEDALU: new Set([
    "abricot", "anthracite", "aubergine", "belinda", "bleu lagon", "bleu marine",
    "bleu pastel", "brun", "chili pepper", "corail", "emeraude", "gris", "jaune chaud",
    "jaune clair", "lila cashmere", "menthe", "myrtille", "noir", "noisette", "ocre",
    "peche", "petrole", "rose pastel", "rouge", "taupe", "turquoise", "vert kale kaki",
    "vert mood", "vert pastel", "violet",
  ]),
  // anneaux 1.22mm  (2 blocs : Lila Cashmere = lila cashmere)
  MINIALU: new Set([
    "abricot", "aubergine", "belipastel", "bleu pastel", "bleu violet", "corail", "emeraude",
    "jaune pastel", "lila cashmere", "marine", "myrtille", "noisette", "ocre", "peche",
    "rose pastel", "rouge", "taupe", "turquoise", "vert pastel", "violet",
  ]),
};

// La couleur Katana est-elle commandable chez Coloral pour ce type d'anneau ?
// (présente dans le fichier directement, ou via un alias). Sinon → on ne la commande pas.
export function coloralColorInFile(type: string, rawColor: string): boolean {
  const set = COLORAL_FILE_COLORS[type];
  if (!set) return false;
  return set.has(resolveColoralColor(rawColor));
}
