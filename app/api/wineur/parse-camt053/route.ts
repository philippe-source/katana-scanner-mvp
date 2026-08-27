import { NextRequest, NextResponse } from "next/server";
import { COMPTES, calculTva } from "@/lib/wineur/accounting";
import type { Ecriture } from "@/lib/wineur/accounting";
import JSZip from "jszip";
import { getMappings, lookupInMap } from "@/lib/wineur/mappings";
import type { UnknownEntry } from "@/lib/wineur/mappings";

// SubFmlyCd → paiement OPAE généré depuis GIT/WinEUR → ignorer
const OPAE_SUB = new Set(["DMCT", "XBCT", "ESCT", "BOOK"]);

// Autres providers de paiement → CRDT = virement provider → banque PostFinance
// Enregistrer : débit pfCompte (banque PostFinance) / crédit compte passage provider
const PROVIDER_PASSAGE: Record<string, string> = {
  "stripe payments": "220006",  // Shopify/Stripe passage (la route Shopify ne l'enregistre plus)
  "sumup payments":  "220004",  // SumUp passage
  "twint acquiring": "220003",  // Twint passage
  "paypal":          "100401",  // PayPal CHF
  "powerpay":        "220005",  // Powerpay passage
  "mf group":        "220005",  // Powerpay (raison sociale MF Group AG)
  "deindeal":        "199001",  // DeinDeal → compte d'attente ventes flash (détail non fourni)
  "qoqa":            "199001",  // Qoqa → compte d'attente ventes flash
  "realdeal":        "199001",  // Realdeals → compte d'attente ventes flash
};

const TAUX = 8.1 / 100;
function r2(n: number) { return Math.round(n * 100) / 100; }

function tagText(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`))?.[1]?.trim() ?? "";
}
function firstBlock(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? "";
}

// Détermine le compte WinEUR PostFinance d'après le dernier chiffre de l'IBAN
function ibanToCompte(iban: string): string {
  const lastDigit = iban.trim().slice(-1);
  if (lastDigit === "5") return "100101";
  if (lastDigit === "9") return "100102";
  if (lastDigit === "7") return "100103";
  return "100101"; // fallback compte principal
}

// ── Dépôts cash des boutiques (versement sur propre compte via carte PostFinance) ──
// Chaque boutique dépose son liquide avec sa propre carte ; le n° de carte identifie la caisse.
const CAISSE_CARTE: Record<string, string> = {
  "8693": "100003", // Martigny
  "0718": "100004", // Carouge
  "0726": "100001", // Orbe (dépôt à Chavornay)
  "9283": "100006", // Fribourg
};

// La ligne est-elle un dépôt cash d'une boutique sur le compte PostFinance ?
function isDepotCaisse(addtl: string): boolean {
  const s = addtl.toUpperCase();
  return s.includes("VERSEMENT SUR PROPRE COMPTE") || s.includes("MOOD STORE Z");
}

// Caisse WinEUR correspondant au dépôt, ou null si la carte est inconnue
function caisseFromDeposit(addtl: string): string | null {
  const s = addtl.toUpperCase();
  // Zürich : dépôt boutique via filiale de la poste, sans carte
  if (s.includes("MOOD STORE Z")) return "100005";
  const card = addtl.match(/CARTE\s*NO\.?\s*X+(\d{4})/i)?.[1];
  if (!card) return null;
  // Carte …0456 : Zermatt si déposé à Zermatt, sinon événements/foire
  if (card === "0456") return /ZERMATT/i.test(addtl) ? "100007" : "100009";
  return CAISSE_CARTE[card] ?? null;
}

// ── Indemnités remboursant un salaire (assurances + caisse chômage) — pas une vente ──
// Détectées uniquement quand l'EXPÉDITEUR est l'organisme (jamais un nom de banque ou de ville).
function isIndemniteSalaire(debtorName: string, addtl: string): boolean {
  const s = `${debtorName} ${addtl}`.toUpperCase();
  if (s.includes("SWICA")) return true;                       // accident / maladie SWICA
  const isZurich = s.includes("ZUERICH") || s.includes("ZÜRICH") || s.includes("ZURICH");
  if (s.includes("VERSICHERUNG") && isZurich) return true;    // Zurich assurance (maladie)
  if (s.includes("CHOMAGE") || s.includes("CHÔMAGE")) return true; // caisse cantonale de chômage
  if (s.includes("CAISSE AVS") || s.includes("CAISSE DE COMPENSATION")) return true; // caisse AVS
  return false;
}

// ── Transferts internes entre comptes Mood (PostFinance ↔ PostFinance / PostFinance ↔ UBS) ──
// Nos 3 comptes PostFinance (par IBAN) et nos 3 comptes UBS (par lettre finale de l'IBAN contrepartie).
const PF_ACCOUNTS: Record<string, string> = {
  "CH5009000000126631485": "100101",
  "CH7509000000147238879": "100102",
  "CH5609000000156657727": "100103",
};
const UBS_LETTER: Record<string, string> = { C: "100201", L: "100202", R: "100203" };

// Si le libellé est "TRANSFERT SUR/DU COMPTE <un de nos IBAN PostFinance>", renvoie le compte concerné.
function pfTransferAccount(addtl: string): string | null {
  const m = addtl.toUpperCase().match(/TRANSFERT (?:SUR|DU) COMPTE\s+([A-Z0-9]+)/);
  return m ? (PF_ACCOUNTS[m[1]] ?? null) : null;
}

// Remboursement provenant d'une administration fiscale (Zurich, Vaud, communes, Confédération…)
function isRemboursementImpot(debtorName: string, comm: string, addtl: string): boolean {
  const s = `${debtorName} ${comm} ${addtl}`.toUpperCase();
  return ["FINANZVERWALTUNG", "STEUERAMT", "STEUERVERWALTUNG", "STEUER", "IMPÔT", "IMPOT", "CONTRIBUTIONS"].some(k => s.includes(k));
}

// lookupPostfinance est appelé avec le config chargé dynamiquement dans POST

interface CamtEntry {
  date: string;
  amount: number;
  direction: "CRDT" | "DBIT";
  subFmlyCd: string;
  debtorName: string;
  creditorName: string;
  country: string;
  communication: string;
  addtlInfo: string;
  pfCompte: string; // compte PostFinance WinEUR selon IBAN du fichier
  counterpartyIban: string; // IBAN de la contrepartie (hors nos comptes PostFinance)
}

function parseEntries(xml: string, iban: string): CamtEntry[] {
  const pfCompte = ibanToCompte(iban);
  const entries: CamtEntry[] = [];
  const ntryBlocks = xml.match(/<Ntry>[\s\S]*?<\/Ntry>/g) ?? [];

  for (const ntry of ntryBlocks) {
    if (tagText(ntry, "Sts") !== "BOOK") continue;

    const direction  = tagText(ntry, "CdtDbtInd") as "CRDT" | "DBIT";
    const amount     = parseFloat(tagText(ntry, "Amt") || "0");
    const date       = tagText(ntry, "Dt");
    const bkTxCd     = firstBlock(ntry, "BkTxCd");
    const subFmlyCd  = tagText(bkTxCd, "SubFmlyCd");
    const txDtls     = firstBlock(ntry, "TxDtls");
    const rltdPties  = firstBlock(txDtls, "RltdPties");
    const dbtrBlock  = firstBlock(rltdPties, "Dbtr");
    const cdtrBlock  = firstBlock(rltdPties, "Cdtr");
    const debtorName  = tagText(dbtrBlock, "Nm");
    const creditorName= tagText(cdtrBlock, "Nm");
    const countryBlock = direction === "CRDT" ? dbtrBlock : cdtrBlock;
    const country    = tagText(firstBlock(countryBlock, "PstlAdr"), "Ctry").toUpperCase();
    const rmtInf     = firstBlock(txDtls, "RmtInf");
    const communication = tagText(rmtInf, "Ustrd")
      || tagText(rmtInf, "Ref")
      || tagText(firstBlock(rmtInf, "CdtrRefInf"), "Ref");
    const addtlInfo  = tagText(ntry, "AddtlNtryInf");
    const counterpartyIban = ([...ntry.matchAll(/<IBAN>([^<]+)<\/IBAN>/g)].map(m => m[1])).find(ib => !(ib in PF_ACCOUNTS)) ?? "";

    entries.push({ date, amount, direction, subFmlyCd, debtorName, creditorName, country, communication, addtlInfo, pfCompte, counterpartyIban });
  }
  return entries;
}

function buildEcritures(entries: CamtEntry[], config: Record<string, string>): { ecritures: Ecriture[]; stats: Record<string, number>; unknowns: UnknownEntry[] } {
  const ecritures: Ecriture[] = [];
  const unknowns: UnknownEntry[] = [];
  const stats = { crdt: 0, crdt_skip: 0, opae: 0, carte: 0, dbit_other: 0, depot_caisse: 0, indemnite: 0, extraordinaire: 0, transfert_pf: 0, transfert_ubs: 0, transfert_etranger: 0, arlette: 0, impot: 0 };

  for (const e of entries) {
    const { date, amount, direction, subFmlyCd, debtorName, creditorName, country, communication, addtlInfo, pfCompte, counterpartyIban } = e;
    const isCH    = country === "CH" || country === "";
    const addtlLc = addtlInfo.toLowerCase();

    // ── Transferts internes entre comptes Mood — pas une vente/charge, sans TVA ──
    const upNames = `${debtorName} ${creditorName}`.toUpperCase();

    // 1) PostFinance ↔ PostFinance : les 2 comptes sont dans le fichier → on comptabilise UNIQUEMENT
    //    la ligne d'entrée (CRDT), directement d'un compte à l'autre ; la ligne de départ (DBIT
    //    "TRANSFERT SUR COMPTE") est ignorée pour ne pas compter le transfert deux fois.
    const pfCptTransfer = pfTransferAccount(addtlInfo);
    if (pfCptTransfer) {
      if (direction === "CRDT") {
        stats.transfert_pf++;
        const lib = `Transfert interne ${addtlInfo.slice(0, 50)}`.replace(/,/g, "-").slice(0, 80);
        ecritures.push({ date, compte: pfCompte,      libelle: lib, montant:  amount }); // compte qui reçoit
        ecritures.push({ date, compte: pfCptTransfer, libelle: lib, montant: -amount }); // compte qui envoie
      }
      continue;
    }

    // 2) Transfert vers notre propre société à l'étranger (Mood Collection USA) → compte d'attente 199001
    if (upNames.includes("MOOD COLLECTION USA")) {
      stats.transfert_etranger++;
      const lib = `Transfert Mood USA ${(communication || addtlInfo).slice(0, 45)}`.replace(/,/g, "-").slice(0, 80);
      if (direction === "DBIT") { // argent quitte PostFinance vers la société US
        ecritures.push({ date, compte: "199001", libelle: lib, montant:  amount });
        ecritures.push({ date, compte: pfCompte,  libelle: lib, montant: -amount });
      } else {                    // argent reçu de la société US
        ecritures.push({ date, compte: pfCompte,  libelle: lib, montant:  amount });
        ecritures.push({ date, compte: "199001",  libelle: lib, montant: -amount });
      }
      continue;
    }

    // 3) PostFinance ↔ UBS : une seule jambe dans le fichier → passée contre le bon compte UBS (lettre C/L/R)
    if (upNames.includes("MOOD COLLECTION SA")) {
      const ubsCpt = counterpartyIban ? (UBS_LETTER[counterpartyIban.slice(-1).toUpperCase()] ?? null) : null;
      if (ubsCpt) {
        stats.transfert_ubs++;
        const lib = `Transfert UBS ${(communication || addtlInfo).slice(0, 45)}`.replace(/,/g, "-").slice(0, 80);
        if (direction === "CRDT") { // UBS → PostFinance
          ecritures.push({ date, compte: pfCompte, libelle: lib, montant:  amount });
          ecritures.push({ date, compte: ubsCpt,   libelle: lib, montant: -amount });
        } else {                    // PostFinance → UBS
          ecritures.push({ date, compte: ubsCpt,   libelle: lib, montant:  amount });
          ecritures.push({ date, compte: pfCompte, libelle: lib, montant: -amount });
        }
        continue;
      }
    }

    // 4) Remboursements d'Arlette Belat → son compte courant 116002 (ni vente ni charge, sans TVA)
    if (upNames.includes("BELAT")) {
      stats.arlette++;
      const lib = `Remb. Arlette ${(communication || addtlInfo).slice(0, 45)}`.replace(/,/g, "-").slice(0, 80);
      if (direction === "CRDT") {
        ecritures.push({ date, compte: pfCompte, libelle: lib, montant:  amount });
        ecritures.push({ date, compte: "116002", libelle: lib, montant: -amount });
      } else {
        ecritures.push({ date, compte: "116002", libelle: lib, montant:  amount });
        ecritures.push({ date, compte: pfCompte, libelle: lib, montant: -amount });
      }
      continue;
    }

    // 5) Remboursement d'impôts (administration fiscale) → compte d'attente 199001, sans TVA
    if (direction === "CRDT" && isRemboursementImpot(debtorName, communication, addtlInfo)) {
      stats.impot++;
      const lib = `Remb. impôts ${(debtorName || communication || addtlInfo).slice(0, 45)}`.replace(/,/g, "-").slice(0, 80);
      ecritures.push({ date, compte: pfCompte, libelle: lib, montant:  amount });
      ecritures.push({ date, compte: "199001", libelle: lib, montant: -amount });
      continue;
    }

    // ── DBIT OPAE → ignorer ──────────────────────────────────────────────────
    const isOpaeGrouped = direction === "DBIT" && addtlLc.includes("ordre groupé opae");
    if ((direction === "DBIT" && OPAE_SUB.has(subFmlyCd)) || isOpaeGrouped) {
      stats.opae++;
      continue;
    }

    // ── CRDT provider de paiement → virement passage provider vers banque PostFinance ──
    // ex: SumUp → 220004 se vide / 100101 reçoit l'argent
    if (direction === "CRDT") {
      const providerEntry = Object.entries(PROVIDER_PASSAGE).find(([k]) => addtlLc.includes(k));
      if (providerEntry) {
        stats.crdt++;
        const [, providerCompte] = providerEntry;
        const ref = (communication || debtorName || addtlInfo.replace(/^CRÉDIT DONNEUR D'ORDRE:\s*/i, "").slice(0, 50) || "Virement").replace(/,/g, "-");
        const lib = `Virement ${ref}`.slice(0, 80);
        ecritures.push({ date, compte: pfCompte,       libelle: lib, montant:  amount }); // banque PostFinance reçoit
        ecritures.push({ date, compte: providerCompte, libelle: lib, montant: -amount }); // compte passage provider se vide
        continue;
      }
    }

    // ── CRDT dépôt cash boutique (versement sur propre compte / MOOD STORE ZÜRICH) ──
    // Ce n'est PAS une vente : la banque monte, la caisse de la boutique baisse, sans TVA.
    if (direction === "CRDT" && isDepotCaisse(addtlInfo)) {
      // Carte perso …9237 = toujours un gain extraordinaire (ex. vente de vieil or, remboursement) → produits extraordinaires 700004, sans TVA
      const carteDepot = addtlInfo.match(/CARTE\s*NO\.?\s*X+(\d{4})/i)?.[1];
      if (carteDepot === "9237") {
        stats.extraordinaire++;
        const refX = addtlInfo.replace(/\s+/g, " ").slice(0, 60).replace(/,/g, "-");
        const libX = `Produit extraordinaire ${refX}`.slice(0, 80);
        ecritures.push({ date, compte: pfCompte, libelle: libX, montant:  amount }); // banque reçoit
        ecritures.push({ date, compte: "700004", libelle: libX, montant: -amount }); // produits extraordinaires
        continue;
      }
      stats.depot_caisse++;
      const caisse = caisseFromDeposit(addtlInfo);
      const ref = addtlInfo.replace(/\s+/g, " ").slice(0, 60).replace(/,/g, "-");
      const lib = `Versement caisse ${ref}`.slice(0, 80);
      if (!caisse) {
        unknowns.push({ key: ref.toLowerCase().slice(0, 80), label: ref.slice(0, 60), amount, date, source: "postfinance" });
      }
      const cpteCaisse = caisse ?? "109999";
      ecritures.push({ date, compte: pfCompte,   libelle: lib, montant:  amount }); // banque reçoit
      ecritures.push({ date, compte: cpteCaisse, libelle: lib, montant: -amount }); // caisse boutique baisse
      continue;
    }

    // ── CRDT indemnité de salaire (SWICA, Zurich assurance, caisse chômage) → 500050, sans TVA ──
    // Ce n'est PAS une vente : la banque monte, l'indemnité vient en déduction des charges de personnel.
    if (direction === "CRDT" && isIndemniteSalaire(debtorName, addtlInfo)) {
      stats.indemnite++;
      const src = debtorName || addtlInfo.replace(/^CRÉDIT\s*(DONNEUR D'ORDRE:)?\s*/i, "").slice(0, 60);
      const ref = src.replace(/\s+/g, " ").slice(0, 60).replace(/,/g, "-");
      const lib = `Indemnité ${ref}`.slice(0, 80);
      ecritures.push({ date, compte: pfCompte, libelle: lib, montant:  amount }); // banque reçoit
      ecritures.push({ date, compte: "500050", libelle: lib, montant: -amount }); // indemnités (déduction charges personnel)
      continue;
    }

    // ── CRDT : rentrée client sur compte PostFinance ─────────────────────────
    if (direction === "CRDT") {
      stats.crdt++;
      const addtlShort = addtlInfo.replace(/^CRÉDIT DONNEUR D'ORDRE:\s*/i, "").slice(0, 60);
      const ref = (communication || debtorName || addtlShort || "Rentrée PostFinance").replace(/,/g, "-");
      const lib = `PostFinance ${ref}`.slice(0, 80);

      if (isCH) {
        const { ht, tva } = calculTva(amount);
        ecritures.push({ date, compte: pfCompte,          libelle: lib,          montant:  amount });
        ecritures.push({ date, compte: COMPTES.VENTE_GEN, libelle: `${lib} HT`,  montant: -ht    });
        ecritures.push({ date, compte: COMPTES.TVA_VENTE, libelle: `${lib} TVA`, montant: -tva   });
      } else {
        ecritures.push({ date, compte: pfCompte,               libelle: lib, montant:  amount });
        ecritures.push({ date, compte: COMPTES.VENTE_ETRANGER, libelle: lib, montant: -amount });
      }
      continue;
    }

    // ── DBIT ICDT/AUTT "CHARGE CPTE CARTE DE CREDIT" → recharge carte ───────
    // 220001 augmente (carte rechargée), pfCompte diminue (compte bancaire)
    if (subFmlyCd === "AUTT" && addtlLc.includes("charge cpte carte de credit")) {
      stats.carte++;
      const ref = addtlInfo.slice(0, 60).replace(/,/g, "-");
      const lib = `PostFinance: ${ref}`.slice(0, 80);
      ecritures.push({ date, compte: "220001", libelle: lib, montant:  amount }); // carte rechargée
      ecritures.push({ date, compte: pfCompte, libelle: lib, montant: -amount }); // compte bancaire débité
      continue;
    }

    // ── DBIT non-OPAE (frais, prélèvements SEPA, autres) ────────────────────
    stats.dbit_other++;
    const ref = (creditorName || addtlInfo.slice(0, 50) || "Débit PostFinance").replace(/,/g, "-");
    const lib = `PostFinance: ${ref}`.slice(0, 80);
    const haystack = `${creditorName} ${communication} ${addtlInfo}`.toLowerCase();
    const cpteCharge = lookupInMap(haystack, config);
    if (!cpteCharge) {
      unknowns.push({ key: haystack.slice(0, 80), label: ref.slice(0, 60), amount, date, source: "postfinance" });
    }
    const cpte = cpteCharge ?? "109999";
    const tvaAcq = r2(amount * TAUX);

    if (isCH) {
      const { ht, tva } = calculTva(amount);
      ecritures.push({ date, compte: cpte,             libelle: `${lib} HT`,          montant:  ht  });
      ecritures.push({ date, compte: COMPTES.TVA_ACQ,  libelle: `TVA CH ${lib}`,       montant:  tva });
    } else {
      ecritures.push({ date, compte: cpte,             libelle: lib,                            montant:  amount   });
      ecritures.push({ date, compte: COMPTES.TVA_ACQ,  libelle: `TVA auto-liq. ${lib}`,        montant:  tvaAcq  });
      ecritures.push({ date, compte: COMPTES.TVA_ACQ,  libelle: `TVA auto-liq. ${lib} (due)`,  montant: -tvaAcq  });
    }
    ecritures.push({ date, compte: pfCompte, libelle: lib, montant: -amount });
  }

  return { ecritures, stats, unknowns };
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const allEntries: CamtEntry[] = [];

  if (file.name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(buffer);
    for (const [name, zipEntry] of Object.entries(zip.files)) {
      if (!name.endsWith(".xml") || zipEntry.dir) continue;
      const xml  = await zipEntry.async("string");
      const iban = xml.match(/<IBAN>([^<]+)<\/IBAN>/)?.[1] ?? "";
      allEntries.push(...parseEntries(xml, iban));
    }
  } else {
    const xml  = buffer.toString("utf8");
    const iban = xml.match(/<IBAN>([^<]+)<\/IBAN>/)?.[1] ?? "";
    allEntries.push(...parseEntries(xml, iban));
  }

  const config = await getMappings("postfinance");
  const { ecritures, stats, unknowns } = buildEcritures(allEntries, config);

  return NextResponse.json({ ecritures, stats, unknowns, total: allEntries.length });
}
