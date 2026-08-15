import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync, inflateSync } from "zlib";
import { COMPTES, calculTva } from "@/lib/wineur/accounting";
import type { Ecriture } from "@/lib/wineur/accounting";

// ── Extraction texte PDF sans dépendance externe ──────────────────────────────
// Utilise uniquement le zlib natif Node.js pour décompresser les streams PDF.
// Suffisant pour les PDFs texte simples comme les décomptes Powerpay.
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("binary");
  const parts: string[] = [];

  // Parcourir tous les streams PDF
  let pos = 0;
  while (pos < raw.length) {
    const si = raw.indexOf("stream", pos);
    if (si === -1) break;

    // Trouver les métadonnées du stream (dans l'objet qui précède)
    const objStart = raw.lastIndexOf("<<", si);
    const meta = objStart >= 0 ? raw.slice(objStart, si) : "";

    // Sauter le \r\n ou \n après "stream"
    let cs = si + 6;
    if (raw[cs] === "\r") cs++;
    if (raw[cs] === "\n") cs++;

    const ei = raw.indexOf("endstream", cs);
    if (ei === -1) break;

    // Extraire le contenu brut du stream
    const streamData = Buffer.from(raw.slice(cs, ei), "binary");
    pos = ei + 9;

    // Tenter décompression (FlateDecode = zlib)
    if (meta.includes("FlateDecode") || meta.includes("Fl")) {
      for (const decompress of [inflateSync, inflateRawSync]) {
        try {
          const text = decompress(streamData).toString("utf8");
          parts.push(text);
          break;
        } catch { /* essayer l'autre méthode */ }
      }
    } else {
      // Stream non compressé — inclure tel quel si lisible
      const text = streamData.toString("utf8");
      if (/[\x20-\x7e]/.test(text)) parts.push(text);
    }
  }

  // Extraire le texte visible des opérateurs PDF
  const result: string[] = [];
  for (const stream of parts) {
    // Strings entre parenthèses suivies de Tj, ', "
    for (const m of stream.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g)) {
      result.push(
        m[1]
          .replace(/\\n/g, "\n").replace(/\\r/g, "\r")
          .replace(/\\\(/g, "(").replace(/\\\)/g, ")")
          .replace(/\\\\/g, "\\")
      );
    }
    // Arrays TJ  [ (text) -kern (text) ... ] TJ
    for (const tj of stream.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const s of tj[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        result.push(s[1]);
      }
    }
  }

  return result.join(" ");
}

// ── Parsing montants suisses ──────────────────────────────────────────────────
const MOIS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03",
  avril: "04", mai: "05", juin: "06", juillet: "07",
  août: "08", aout: "08", septembre: "09", octobre: "10",
  novembre: "11", décembre: "12", decembre: "12",
};

function cleanAmount(raw: string): number {
  let s = raw.replace(/CHF/gi, "").replace(/'/g, "").replace(/\s/g, "").trim();
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(".") > s.lastIndexOf(",")
      ? s.replace(/,/g, "")
      : s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  return parseFloat(s) || 0;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const text   = extractPdfText(buffer);

  if (!text || text.trim().length < 50) {
    return NextResponse.json({ error: "Impossible d'extraire le texte du PDF Powerpay" }, { status: 400 });
  }

  // Date : "St. Gallen, 18 mai 2026"
  // Le nom du mois peut ressortir deforme selon la police du PDF ("aout" ->
  // "août", "ao√ªt", "ao?t"...). On accepte donc n'importe quels caracteres
  // non chiffres pour le mois, puis on identifie le mois sur ses 2 premieres
  // lettres. Si rien ne marche, on retombe sur la derniere date du tableau.
  let date = "";
  const mDate = text.match(/St\.\s*Gallen[,\s]+(\d{1,2})\s+([^\d\s]{2,20})\s+(\d{4})/i);
  if (mDate) {
    const brut = mDate[2].toLowerCase();
    let moisNum = MOIS[brut];
    if (!moisNum) {
      // rapprochement tolerant : "ao??t" reste reconnaissable a "ao"
      const cle = Object.keys(MOIS).find(k => k.slice(0, 2) === brut.slice(0, 2));
      if (cle) moisNum = MOIS[cle];
    }
    if (moisNum) date = `${mDate[3]}-${moisNum}-${mDate[1].padStart(2, "0")}`;
  }
  if (!date) {
    // Filet de securite : la date la plus recente du tableau des transactions
    const jours = [...text.matchAll(/\b(\d{2})\.(\d{2})\.(\d{4})\b/g)]
      .map(m => `${m[3]}-${m[2]}-${m[1]}`)
      .sort();
    if (jours.length) date = jours[jours.length - 1];
  }
  if (!date) {
    return NextResponse.json(
      { error: "Date du decompte Powerpay introuvable : ni l'en-tete 'St. Gallen, ...' ni aucune date de transaction n'a pu etre lue dans ce PDF." },
      { status: 400 },
    );
  }

  // Période : "semaine 19/20"
  const mPer = text.match(/semaine\s+([0-9]{1,2}[/\-][0-9]{1,2})/i);
  const periode = mPer ? `semaine ${mPer[1]}` : "décompte";

  // Montants — "Note de crédit" peut être mal encodé selon la police PDF.
  // On utilise "Solde dû" + "Commission CHF" → net_credit = solde - commission.
  const mComm  = text.match(/Commission\s+CHF\s*([-]?[\d',.\s]+)/i);
  const mSolde = text.match(/Solde\s+d.{0,4}CHF\s*([\d',.]+)/i); // sans \s pour ne pas capturer le numéro de page
  // Fallback : chercher "Note de crédit" avec pattern large
  const mCredit = text.match(/Note\s+de\s+cr.{1,6}dit\s+d.{1,10}commission\s+en\s+CHF\s*([\d',.\s]+)/i);

  if (!mComm)  return NextResponse.json({ error: "Montant 'Commission CHF' introuvable" }, { status: 400 });
  if (!mSolde && !mCredit) return NextResponse.json({ error: "Montant total (Solde dû / Note de crédit) introuvable" }, { status: 400 });

  const commission = Math.abs(cleanAmount(mComm[1]));
  let totalVentes: number;
  let netCredit:   number;

  if (mSolde) {
    // Chemin principal : Solde dû = total ventes brutes
    totalVentes = cleanAmount(mSolde[1]);
    netCredit   = Math.round((totalVentes - commission) * 100) / 100;
  } else {
    // Fallback : Note de crédit + Commission
    netCredit   = cleanAmount(mCredit![1]);
    totalVentes = Math.round((netCredit + commission) * 100) / 100;
  }

  const { ht, tva } = calculTva(totalVentes);
  const lib = `Powerpay ${periode}`;

  const ecritures: Ecriture[] = [
    { date, compte: COMPTES.PASSAGE_POWERPAY, libelle: lib,           montant:  totalVentes },
    { date, compte: COMPTES.VENTE_GEN,        libelle: `${lib} HT`,   montant: -ht          },
    { date, compte: COMPTES.TVA_VENTE,        libelle: `${lib} TVA`,  montant: -tva         },
  ];

  if (commission > 0) {
    ecritures.push({ date, compte: COMPTES.FRAIS,          libelle: `Commission ${lib}`, montant:  commission });
    ecritures.push({ date, compte: COMPTES.PASSAGE_POWERPAY, libelle: `Commission ${lib}`, montant: -commission });
  }

  return NextResponse.json({ ecritures, date, periode, netCredit, commission, totalVentes });
}
