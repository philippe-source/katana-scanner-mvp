// WinEUR accounting logic — ported from hub_wineur_patched_v77.py

export const TAUX_TVA = 8.1;
const TAUX = TAUX_TVA / 100;

export const COMPTES = {
  PASSAGE_TWINT:       "220003",
  PASSAGE_SUMUP:       "220004",
  PASSAGE_PAYPAL_CHF:  "100401",
  PASSAGE_PAYPAL_EUR:  "100402",
  PASSAGE_PAYPAL_GBP:  "100403",
  PASSAGE_PAYPAL_USD:  "100404",
  PASSAGE_PAYPAL_CAD:  "100405",
  PASSAGE_PAYPAL_AUD:  "100406",
  PASSAGE_SHOPIFY:     "220006",
  PASSAGE_POSTFINANCE: "220001",
  PASSAGE_POWERPAY:    "220005",
  TVA_ACQ:             "117001",
  TVA_VENTE:           "217001",
  FRAIS:               "640004",
  COMMISSION:          "640002",
  VENTE_GEN:           "320001",
  DIFF_CHANGE:         "670004",
} as const;

export interface Ecriture {
  date: string;       // YYYY-MM-DD
  compte: string;
  libelle: string;
  montant: number;
  montant_orig?: number;
  devise?: string;
}

export function calculTva(brut: number): { ht: number; tva: number } {
  const ht = Math.round((brut / (1 + TAUX)) * 100) / 100;
  const tva = Math.round((brut - ht) * 100) / 100;
  return { ht, tva };
}

// mode CH = vente suisse (TVA ventilée), EXT = acquisition étrangère, NON = sans TVA
export function formatEcriture(
  date: string,
  lib: string,
  brut: number,
  cpteV: string,
  frais: number,
  mode: "CH" | "EXT" | "NON" = "CH",
  cptPassage: string = COMPTES.PASSAGE_TWINT,
): Ecriture[] {
  const { ht, tva } = calculTva(brut);
  const lignes: Ecriture[] = [{ date, compte: cptPassage, libelle: lib, montant: brut }];

  if (mode === "EXT") {
    const tvaAcq = Math.round(Math.abs(brut) * TAUX * 100) / 100;
    lignes.push({ date, compte: cpteV, libelle: `${lib} (Acquis.)`, montant: -brut });
    lignes.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA s/acquis. ${lib}`, montant: tvaAcq });
    lignes.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA s/acquis. ${lib} (due)`, montant: -tvaAcq });
  } else if (mode === "NON") {
    lignes.push({ date, compte: cpteV, libelle: lib, montant: -brut });
  } else {
    lignes.push({ date, compte: cpteV, libelle: `${lib} HT`, montant: -ht });
    lignes.push({ date, compte: COMPTES.TVA_VENTE, libelle: `${lib} TVA`, montant: -tva });
  }

  if (frais !== 0) {
    lignes.push({ date, compte: COMPTES.FRAIS, libelle: `Frais ${lib}`, montant: Math.abs(frais) });
    lignes.push({ date, compte: cptPassage, libelle: `Frais ${lib}`, montant: -Math.abs(frais) });
  }

  return lignes;
}

export function aggregateDaily(ecritures: Ecriture[], journalName: string): Ecriture[] {
  const agg = new Map<string, number>();
  const deviseMap = new Map<string, string>();

  for (const e of ecritures) {
    const devise = e.devise?.trim() ?? "";
    const key = `${e.date}|${e.compte}|${devise}`;
    agg.set(key, Math.round(((agg.get(key) ?? 0) + e.montant) * 100) / 100);
    if (devise) deviseMap.set(key, devise);
  }

  const result: Ecriture[] = [];
  for (const [key, montant] of [...agg.entries()].sort()) {
    if (Math.round(montant * 100) === 0) continue;
    const [date, compte, devise] = key.split("|");
    result.push({
      date,
      compte,
      libelle: `${journalName} ${date}`,
      montant: Math.round(montant * 100) / 100,
      ...(devise ? { devise } : {}),
    });
  }
  return result;
}

export function toCsv(ecritures: Ecriture[]): string {
  const hasDevise = ecritures.some((e) => e.devise || e.montant_orig !== undefined);
  const hasMontantOrig = ecritures.some((e) => e.montant_orig !== undefined);

  let header: string;
  if (hasMontantOrig) {
    header = "date,compte,libelle,montant_ref,montant_orig,devise";
  } else if (hasDevise) {
    header = "date,compte,libelle,montant,devise";
  } else {
    header = "date,compte,libelle,montant";
  }

  const rows = ecritures.map((e) => {
    const lib = e.libelle.replace(/,/g, "-");
    if (hasMontantOrig) {
      return `${e.date},${e.compte},${lib},${e.montant},${e.montant_orig ?? ""},${e.devise ?? ""}`;
    } else if (hasDevise) {
      return `${e.date},${e.compte},${lib},${e.montant},${e.devise ?? ""}`;
    } else {
      return `${e.date},${e.compte},${lib},${e.montant}`;
    }
  });

  return [header, ...rows].join("\n");
}

// SumUp boutique → compte WinEUR
export const SUMUP_COMPTES: Record<string, { lieu: string; compte: string }> = {
  "carouge@yourmood.net":  { lieu: "Carouge",     compte: "320004" },
  "orbe@yourmood.net":     { lieu: "Orbe",         compte: "320002" },
  "manor@yourmood.net":    { lieu: "Stand-foire",  compte: "320009" },
  "martigny@yourmood.net": { lieu: "Martigny",     compte: "320003" },
  "zurich@yourmood.net":   { lieu: "Zurich",       compte: "320005" },
  // 320006 = "Ventes a l'etranger" et NON Fribourg : Fribourg est 320007.
  "fribourg@yourmood.net": { lieu: "Fribourg",     compte: "320007" },
  "zermatt@yourmood.net":  { lieu: "Zermatt",      compte: "320008" },
  // Compte des foires (320009 = "Ventes caisse evenements"). Ligne absente
  // jusqu'au 14.08.2026 : 56 ventes (11'491.00 CHF) de janvier a juillet 2026
  // avaient disparu en silence, faute de cette correspondance.
  "fdv@yourmood.net":      { lieu: "Stand-foire",  compte: "320009" },
  // Paiements par lien encaisses depuis les comptes de Stephanie et de
  // Fabienne (mode "ECOM"). Absents de cette table jusqu'au 15.08.2026 :
  // 6 encaissements, 9'443.95 CHF de fevrier a juillet 2026, jamais reprise.
  "stephanie@yourmood.net": { lieu: "Online",      compte: "320001" },
  "fabienne@yourmood.net":  { lieu: "Online",      compte: "320001" },
};

export const PAYPAL_COMPTES: Record<string, string> = {
  CHF: COMPTES.PASSAGE_PAYPAL_CHF,
  EUR: COMPTES.PASSAGE_PAYPAL_EUR,
  USD: COMPTES.PASSAGE_PAYPAL_USD,
};
