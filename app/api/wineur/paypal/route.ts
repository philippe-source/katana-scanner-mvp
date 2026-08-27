import { NextRequest, NextResponse } from "next/server";
import { COMPTES, calculTva } from "@/lib/wineur/accounting";
import type { Ecriture } from "@/lib/wineur/accounting";
import { getESTVRate } from "@/lib/wineur/estv-rates";
import { getMappings, lookupInMap } from "@/lib/wineur/mappings";
import type { UnknownEntry } from "@/lib/wineur/mappings";

const CLIENT_ID     = process.env.PAYPAL_CLIENT_ID!;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!;
const TAUX = 8.1 / 100;

const PAYPAL_COMPTES: Record<string, string> = {
  CHF: COMPTES.PASSAGE_PAYPAL_CHF,
  EUR: COMPTES.PASSAGE_PAYPAL_EUR,
  GBP: COMPTES.PASSAGE_PAYPAL_GBP,
  USD: COMPTES.PASSAGE_PAYPAL_USD,
  CAD: COMPTES.PASSAGE_PAYPAL_CAD,
  AUD: COMPTES.PASSAGE_PAYPAL_AUD,
};

async function getToken(): Promise<string> {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await res.json() as { access_token?: string };
  if (!j.access_token) throw new Error("PayPal auth failed");
  return j.access_token;
}

function r2(n: number) { return Math.round(n * 100) / 100; }

function e(out: Ecriture[], date: string, compte: string, libelle: string, montant: number, montant_orig?: number, devise?: string) {
  out.push({
    date,
    compte,
    libelle: libelle.replace(/,/g, "-").slice(0, 80),
    montant: r2(montant),
    ...(montant_orig !== undefined ? { montant_orig: r2(montant_orig) } : {}),
    ...(devise ? { devise } : {}),
  });
}


function parsePayerInfo(payer: Record<string, unknown>) {
  const nameObj  = payer?.payer_name as Record<string, string> | null;
  const altName  = nameObj?.alternate_full_name ?? `${nameObj?.given_name ?? ""} ${nameObj?.surname ?? ""}`.trim();
  const nom      = altName || "PayPal";
  const email    = String(payer?.email_address ?? "");
  const country  = String(payer?.country_code ?? "").toUpperCase();
  return { nom, email, country, isCH: country === "CH" };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end   = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start et end requis" }, { status: 400 });

  const token = await getToken();
  const res = await fetch(
    `https://api-m.paypal.com/v1/reporting/transactions?start_date=${start}T00:00:00-0000&end_date=${end}T23:59:59-0000&fields=all&page_size=500`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return NextResponse.json({ error: `PayPal API ${res.status}` }, { status: 502 });

  const data = await res.json() as { transaction_details?: Record<string, unknown>[] };
  const txs  = data.transaction_details ?? [];
  const ecritures: Ecriture[] = [];
  const unknowns:  UnknownEntry[] = [];
  const mappings   = await getMappings("paypal");

  // Codes ignorés (aucune écriture) :
  //  T1501 / T1105 — paires internes PayPal qui se neutralisent
  //  T0700 — recharge du solde PayPal par la carte Visa PF : désormais portée
  //          en entier par l'import Visa (écriture unique 100401 / 220001), pas ici.
  const IGNORE_CODES = new Set(["T1501", "T1105", "T0700"]);

  for (const tx of txs) {
    const info  = tx.transaction_info as Record<string, unknown>;
    const payer = tx.payer_info       as Record<string, unknown>;
    if (String(info.transaction_status ?? "") !== "S") continue;

    const code    = String(info.transaction_event_code ?? "");
    if (IGNORE_CODES.has(code)) continue;

    const amtObj  = info.transaction_amount as Record<string, unknown>;
    const feeObj  = info.fee_amount          as Record<string, unknown> | null;
    const rawAmt  = Number(amtObj?.value ?? 0);
    const rawFee  = Number(feeObj?.value ?? 0);           // négatif dans l'API PayPal
    const fee     = Math.abs(rawFee);
    const devise  = String(amtObj?.currency_code ?? "CHF").toUpperCase();
    const feeDev  = String(feeObj?.currency_code ?? devise).toUpperCase();
    const date    = String(info.transaction_initiation_date ?? "").slice(0, 10);
    const cpte    = PAYPAL_COMPTES[devise] ?? COMPTES.PASSAGE_PAYPAL_CHF;
    const { nom, email, country, isCH } = parsePayerInfo(payer);

    // ═══════════════════════════════════════════════════════════════
    // T0200 — Conversion de devise standard
    // T0201 — Conversion de devise initiée par l'utilisateur
    //   ATTENTION : T0201 n'est PAS un remboursement client. Chez PayPal,
    //   T0200 = "General currency conversion" et T0201 = "User initiated
    //   currency conversion". T0201 était traité plus bas comme un
    //   remboursement : cela sortait l'argent du compte PayPal au lieu de
    //   l'y faire entrer, ET diminuait le compte de ventes 320001.
    //   Constaté sur janvier–juillet 2026 : 43 conversions (23 CHF + 20 EUR)
    //   ont ainsi réduit les ventes de 13'686.87 CHF à tort.
    //   Les vrais remboursements client sont T1107 (et T1106/T1110).
    // Enregistre le débit du compte devise ; l'écart de change est absorbé
    // par le compte 670004 (différence de change — son vrai usage).
    // (La recharge du solde PayPal par la carte (ex-T0700) est désormais
    //  portée par l'import Visa, elle ne transite plus par 670004.)
    // ═══════════════════════════════════════════════════════════════
    if (code === "T0200" || code === "T0201") {
      // montant = contre-valeur CHF (ESTV), montant_orig = montant en devise
      // DIFF_CHANGE (670004) absorbe l'écart entre le taux ESTV et le taux réel PayPal
      const lib        = `PayPal conversion ${devise}→CHF`;
      const rate       = await getESTVRate(date, devise);
      const rawAmtChf  = r2(rawAmt * rate);
      e(ecritures, date, cpte,               lib,  rawAmtChf,  rawAmt, devise);
      e(ecritures, date, COMPTES.DIFF_CHANGE, lib, -rawAmtChf);
      continue;
    }

    // T0700 (recharge du solde PayPal par la carte Visa PF) est ignoré ici —
    // voir IGNORE_CODES : l'écriture est portée en entier par l'import Visa.

    // ═══════════════════════════════════════════════════════════════
    // T1107 — Remboursement client (initié par le marchand)
    //   T0201 a été retiré d'ici : c'est une conversion de devise, pas un
    //   remboursement (voir le bloc des conversions ci-dessus).
    // ═══════════════════════════════════════════════════════════════
    if (code === "T1107") {
      const brut = Math.abs(rawAmt);
      const lib  = `Rembt PayPal${nom !== "PayPal" ? ": " + nom : ""}`;
      // Le pays de la cliente decide, pas le code du mouvement : un remboursement
      // a une cliente hors Suisse ne reprend aucune TVA suisse.
      const isRefundCH = isCH;
      if (isRefundCH) {
        // Si remboursement en devise : convertir en CHF pour le montant de
        // référence (HT/TVA + ligne du compte), et garder le montant d'origine
        // + la devise sur la ligne du compte de passage (ex. 100402 EUR).
        const rate        = devise !== "CHF" ? await getESTVRate(date, devise) : 1;
        const brutChf     = r2(brut * rate);
        const { ht, tva } = calculTva(brutChf);
        e(ecritures, date, COMPTES.VENTE_GEN, `${lib} HT`,  ht);
        e(ecritures, date, COMPTES.TVA_VENTE, `${lib} TVA`, tva);
        e(ecritures, date, cpte,              lib,          -brutChf, devise !== "CHF" ? -brut : undefined, devise !== "CHF" ? devise : undefined);
      } else {
        // Étranger : pas de TVA suisse → montant CHF converti via ESTV
        const brutChf = devise !== "CHF" ? r2(brut * await getESTVRate(date, devise)) : brut;
        e(ecritures, date, COMPTES.VENTE_ETRANGER, lib,  brutChf);
        e(ecritures, date, cpte,                   lib, -brutChf, devise !== "CHF" ? -brut : undefined, devise !== "CHF" ? devise : undefined);
      }
      continue;
    }

    // ═══════════════════════════════════════════════════════════════
    // Le SIGNE du montant fait foi :
    //   montant positif = argent qui RENTRE  → vente / encaissement → 320001
    //   montant négatif = argent qui SORT    → paiement fournisseur → mapping compte
    // (T0006 = encaissement par caisse Express Checkout = une VENTE, jamais
    //  un paiement sortant — c'est pourquoi le code ne sert pas à classer ici.)
    // ═══════════════════════════════════════════════════════════════
    const lib = `PayPal: ${nom}`;

    // ── VENTE / ENCAISSEMENT ────────────────────────────────────────
    if (rawAmt > 0) {
      const brut = rawAmt;
      const { ht, tva } = calculTva(brut);

      if (isCH) {
        // Client CH : TVA suisse — si paiement en devise, convertir HT/TVA en CHF
        const rate    = devise !== "CHF" ? await getESTVRate(date, devise) : 1;
        const brutChf = r2(brut * rate);
        const { ht: htChf, tva: tvaChf } = calculTva(brutChf);
        e(ecritures, date, cpte,              lib,           brutChf, devise !== "CHF" ? brut : undefined, devise !== "CHF" ? devise : undefined);
        e(ecritures, date, COMPTES.VENTE_GEN, `${lib} HT`, -htChf);
        e(ecritures, date, COMPTES.TVA_VENTE, `${lib} TVA`,-tvaChf);
        void ht; void tva;
      } else {
        // Client étranger → pas de TVA suisse
        if (devise === "CHF") {
          e(ecritures, date, cpte,                   lib, brut);
          e(ecritures, date, COMPTES.VENTE_ETRANGER, lib, -brut);
        } else {
          const brutChf = r2(brut * await getESTVRate(date, devise));
          e(ecritures, date, cpte,                   lib,  brutChf, brut, devise);
          e(ecritures, date, COMPTES.VENTE_ETRANGER, lib, -brutChf);
        }
      }

      // Frais de transaction PayPal (dans la devise de la vente)
      if (fee > 0) {
        const cpteComm = PAYPAL_COMPTES[feeDev] ?? COMPTES.PASSAGE_PAYPAL_CHF;
        if (feeDev === "CHF") {
          e(ecritures, date, COMPTES.COMMISSION, `Commission ${lib}`, fee);
          e(ecritures, date, cpteComm,           `Commission ${lib}`,-fee);
        } else {
          // Frais en devise étrangère : 640002 est en CHF, compte PayPal en devise
          const feeChf = r2(fee * await getESTVRate(date, feeDev));
          e(ecritures, date, COMPTES.COMMISSION, `Commission ${lib}`,  feeChf);
          e(ecritures, date, cpteComm,           `Commission ${lib}`, -feeChf, -fee, feeDev);
        }
      }
    }

    // ── PAIEMENT FOURNISSEUR ────────────────────────────────────────
    if (rawAmt < 0) {
      const brut       = Math.abs(rawAmt);
      const haystack   = `${nom} ${email}`.toLowerCase();
      const cpteCharge = lookupInMap(haystack, mappings);
      if (!cpteCharge) {
        unknowns.push({ key: haystack.trim(), label: nom, amount: brut, date, source: "paypal" });
        continue;
      }

      if (isCH) {
        // Fournisseur suisse : brut = TTC → HT + TVA récupérable (en CHF)
        const brutChf         = devise !== "CHF" ? r2(brut * await getESTVRate(date, devise)) : brut;
        const { ht, tva }     = calculTva(brutChf);
        e(ecritures, date, cpteCharge,       `${lib} HT`,              ht);
        e(ecritures, date, COMPTES.TVA_ACQ,  `TVA CH ${lib}`,          tva);
        e(ecritures, date, cpte,             lib,                      -brutChf, devise !== "CHF" ? -brut : undefined, devise !== "CHF" ? devise : undefined);
      } else {
        // Fournisseur étranger : brut = HT (en devise étrangère)
        // Le compte de charge est en CHF → conversion via taux ESTV du mois
        if (devise === "CHF") {
          const tvaAcq = r2(brut * TAUX);
          e(ecritures, date, cpteCharge,       lib,                             brut);
          e(ecritures, date, COMPTES.TVA_ACQ,  `TVA auto-liq. ${lib}`,         tvaAcq);
          e(ecritures, date, COMPTES.TVA_ACQ,  `TVA auto-liq. ${lib} (due)`,  -tvaAcq);
          e(ecritures, date, cpte,             lib,                            -brut);
        } else {
          const rate    = await getESTVRate(date, devise);
          const brutChf = r2(brut * rate);
          const tvaAcq  = r2(brutChf * TAUX);
          // Compte de charge : compte CHF, montant converti — pas de devise étrangère
          e(ecritures, date, cpteCharge,       lib,                             brutChf);
          e(ecritures, date, COMPTES.TVA_ACQ,  `TVA auto-liq. ${lib}`,         tvaAcq);
          e(ecritures, date, COMPTES.TVA_ACQ,  `TVA auto-liq. ${lib} (due)`,  -tvaAcq);
          // Compte PayPal devise : montant CHF + montant_orig en devise pour réconciliation
          e(ecritures, date, cpte,             lib,                            -brutChf, -brut, devise);
        }
      }
    }
  }

  return NextResponse.json({ ecritures, unknowns, count: txs.length });
}
