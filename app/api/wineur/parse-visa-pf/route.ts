import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync, inflateSync } from "zlib";
import { COMPTES, calculTva } from "@/lib/wineur/accounting";
import type { Ecriture } from "@/lib/wineur/accounting";
import { getMappings, lookupInMap } from "@/lib/wineur/mappings";
import type { UnknownEntry } from "@/lib/wineur/mappings";

// ── Extraction texte PDF — retourne toutes les strings dans l'ordre ───────────
function extractPdfStrings(buffer: Buffer): string[] {
  const raw = buffer.toString("binary");
  const allStrings: string[] = [];
  let pos = 0;

  while (pos < raw.length) {
    const si = raw.indexOf("stream", pos);
    if (si === -1) break;
    const objStart = raw.lastIndexOf("<<", si);
    const meta = objStart >= 0 ? raw.slice(objStart, si) : "";
    let cs = si + 6;
    if (raw[cs] === "\r") cs++;
    if (raw[cs] === "\n") cs++;
    const ei = raw.indexOf("endstream", cs);
    if (ei === -1) break;
    const streamData = Buffer.from(raw.slice(cs, ei), "binary");
    pos = ei + 9;

    let streamText = "";
    if (meta.includes("FlateDecode") || meta.includes("Fl")) {
      for (const decompress of [inflateSync, inflateRawSync]) {
        try { streamText = decompress(streamData).toString("utf8"); break; } catch { /* try next */ }
      }
    } else {
      streamText = streamData.toString("utf8");
    }

    if (!streamText || !streamText.includes("Tj")) continue;

    // Extraire les strings des opérateurs Tj
    for (const m of streamText.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = m[1]
        .replace(/\\n/g, "\n").replace(/\\r/g, "\r")
        .replace(/\\\(/g, "(").replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\").trim();
      if (s) allStrings.push(s);
    }
    // Extraire les strings des arrays TJ
    for (const tj of streamText.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const s of tj[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        const v = s[1].trim();
        if (v) allStrings.push(v);
      }
    }
  }

  return allStrings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const TAUX = 8.1 / 100;
function r2(n: number) { return Math.round(n * 100) / 100; }

const FOREIGN_CODES = ["IRL", "USA", "DEU", "LUX", "GBR", "EST", "AUT", "FRA", "DNK", "FIN", "NLD", "BEL", "ITA", "ESP"];
const SKIP_DESCS    = ["recharge en ligne", "recharge", "total des paiements", "report", "total postfinance", "report du solde"];

function normalizeMerchant(text: string): string {
  return text.replace(/'/g, "").replace(/\s+/g, " ")
    .replace(/\s*(CHF|EUR|USD|GBP)\s*[-+]?\d[\d\s.,]*$/i, "").trim().toLowerCase();
}
function isPaypalTopup(description: string): boolean {
  return description.toUpperCase().replace(/\s+/g, "").includes("PAYPAL*");
}
function isExt(description: string): boolean {
  return FOREIGN_CODES.some(c => description.toUpperCase().includes(c));
}
function isShopify(description: string): boolean {
  return description.toLowerCase().includes("shopify");
}
function isVercel(description: string): boolean {
  return description.toLowerCase().includes("vercel");
}
function parseDate(ddmmyy: string): string {
  const [d, m, y] = ddmmyy.split(".");
  return `20${y}-${m}-${d}`;
}
function isDate(s: string): boolean {
  return /^\d{2}\.\d{2}\.\d{2}$/.test(s.trim());
}
function cleanAmount(s: string): number {
  return parseFloat(s.replace(/'/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "")) || 0;
}
function isAmount(s: string): boolean {
  const v = cleanAmount(s);
  return !isNaN(v) && s.match(/\d/) !== null;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const strings = extractPdfStrings(buffer);

  if (strings.length < 10) {
    return NextResponse.json({ error: "Impossible d'extraire le texte du PDF Visa PostFinance" }, { status: 400 });
  }

  const config = await getMappings("postfinance");
  const ecritures: Ecriture[] = [];
  const unknowns: UnknownEntry[] = [];
  let imported = 0;

  // Parcourir les strings en cherchant le pattern : date1, date2, description, montant
  // Les strings "Recharge" et autres à ignorer = date seule (pas suivie d'une 2ème date)
  let i = 0;
  while (i < strings.length) {
    const s = strings[i];

    // On cherche deux dates consécutives (Comptabilisation + Achat)
    if (isDate(s) && i + 1 < strings.length && isDate(strings[i + 1])) {
      const dateC      = s.trim();
      // i+1 = date achat, i+2 = description (peut être plusieurs fragments), dernier avant montant = montant
      // Chercher le montant : premier nombre positif après les deux dates
      let descParts: string[] = [];
      let montantStr = "";
      let j = i + 2;

      // Un achat en devise etrangere porte DEUX montants sur la ligne :
      //   ... SHOPIFY DUBLIN IRL      USD  3'876.92      3'196.25
      // le premier est en devise, le second est le montant reellement debite
      // en francs. Prendre le premier revenait a comptabiliser des dollars
      // comme des francs : surevaluation d'environ 20 % sur chaque achat
      // etranger (12'388.91 CHF constates sur janvier-juillet 2026).
      // Regle : si un code de devise etrangere apparait sur la ligne, le
      // montant en francs est le DERNIER nombre positif, pas le premier.
      const montants: string[] = [];
      let deviseEtrangere = false;

      while (j < strings.length && j < i + 12) {
        const candidate = strings[j];
        if (isDate(candidate)) break; // nouvelle date = fin de cette transaction
        const brut = candidate.trim().toUpperCase();
        if (/^(USD|EUR|GBP|SEK|DKK|NOK|CAD|AUD|JPY|PLN|CZK)$/.test(brut)) deviseEtrangere = true;
        const amt = cleanAmount(candidate);
        // Le montant Visa est positif et > 0 (les crédits ont un - donc <= 0)
        if (candidate.match(/^\d/) && amt > 0 && !isNaN(amt)) {
          montants.push(candidate);
          j++;
          if (!deviseEtrangere) break;   // en francs : un seul montant
          if (montants.length >= 2) break; // en devise : devise puis francs
          continue;
        }
        if (candidate.trim() && montants.length === 0) descParts.push(candidate.trim());
        j++;
      }

      montantStr = deviseEtrangere && montants.length >= 2
        ? montants[montants.length - 1]
        : (montants[0] ?? "");

      const description = descParts.join(" ").trim();
      const montantVal  = cleanAmount(montantStr);

      // Avancer l'index
      i = j;

      if (!description || montantVal <= 0) continue;

      // Ignorer les lignes de recharge et totaux
      const descLc = description.toLowerCase();
      if (SKIP_DESCS.some(k => descLc.includes(k))) continue;

      const date = parseDate(dateC);
      const lib  = `CC PF: ${normalizeMerchant(description).toUpperCase().slice(0, 35)}`;

      // PAYPAL * → recharge du solde PayPal payée par la carte = virement interne
      // entre deux comptes à nous : la carte (220001) finance le solde PayPal (100401).
      // UNE écriture équilibrée, datée à l'opération (chaque ligne porte sa propre date,
      // donc le mois est juste sans compte de transit). L'import PayPal n'enregistre plus
      // ce flux (code T0700 ignoré) → aucune double saisie, plus de 670004.
      if (isPaypalTopup(description)) {
        const libPP = `Recharge PayPal CC PF: ${description.slice(0, 30)}`;
        ecritures.push({ date, compte: "100401", libelle: libPP, montant:  montantVal });
        ecritures.push({ date, compte: "220001", libelle: libPP, montant: -montantVal });
        imported++;
        continue;
      }

      const cpte = lookupInMap(normalizeMerchant(description), config);

      if (!cpte) {
        unknowns.push({ key: normalizeMerchant(description), label: description.slice(0, 60), amount: montantVal, date, source: "postfinance" });
        const tvaAcq = r2(montantVal * TAUX);
        ecritures.push({ date, compte: "109999",        libelle: `ATTENTE ${lib}`, montant:  montantVal });
        ecritures.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA auto-liq. ${lib}`, montant:  tvaAcq });
        ecritures.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA auto-liq. ${lib} (due)`, montant: -tvaAcq });
        ecritures.push({ date, compte: "220001",        libelle: `ATTENTE ${lib}`, montant: -montantVal });
        imported++;
        continue;
      }

      const mode      = (!isExt(description) || isShopify(description) || isVercel(description)) ? "CH" : "EXT";
      const { ht, tva } = calculTva(montantVal);
      const tvaAcq    = r2(montantVal * TAUX);

      // 220001 = compte type bancaire : un PAIEMENT par carte le VIDE (−),
      // la charge correspondante AUGMENTE (+). (Une recharge de carte, côté
      // relevé bancaire, le REMPLIT en +.)
      if (mode === "CH") {
        ecritures.push({ date, compte: "220001",        libelle: lib,                           montant: -montantVal });
        ecritures.push({ date, compte: cpte,            libelle: `${lib} HT`,                  montant:  ht         });
        ecritures.push({ date, compte: COMPTES.TVA_ACQ, libelle: `${lib} TVA`,                 montant:  tva        });
      } else {
        ecritures.push({ date, compte: "220001",        libelle: lib,                           montant: -montantVal });
        ecritures.push({ date, compte: cpte,            libelle: `${lib} (Acquis.)`,            montant:  montantVal });
        ecritures.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA s/acquis. ${lib}`,       montant:  tvaAcq    });
        ecritures.push({ date, compte: COMPTES.TVA_ACQ, libelle: `TVA s/acquis. ${lib} (due)`, montant: -tvaAcq    });
      }
      imported++;
    } else {
      i++;
    }
  }

  return NextResponse.json({ ecritures, imported, unknowns });
}
