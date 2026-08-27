import { NextRequest, NextResponse } from "next/server";
import { COMPTES, calculTva, formatEcriture } from "@/lib/wineur/accounting";
import type { Ecriture } from "@/lib/wineur/accounting";

const API_V = "2025-01";

// Toutes les boutiques configurées — supporte les deux noms de variables (local + Vercel)
const STORES = [
  {
    name:  "yourmood",
    shop:  process.env.SHOPIFY_PAYOUTS_SHOP   || process.env.MOOD_SHOPIFY_DOMAIN!,
    token: process.env.SHOPIFY_PAYOUTS_TOKEN  || process.env.MOOD_SHOPIFY_ACCESS_TOKEN!,
  },
  {
    name:  "joaillerie",
    shop:  process.env.SHOPIFY_JOAILLERIE_SHOP  || process.env.MOODJOAILLERIE_SHOPIFY_DOMAIN!,
    token: process.env.SHOPIFY_JOAILLERIE_TOKEN || process.env.MOODJOAILLERIE_SHOPIFY_ACCESS_TOKEN!,
  },
  {
    name:  "marketplace",
    shop:  process.env.SHOPIFY_MARKETPLACE_SHOP  || process.env.MOODMARKETPLACE_SHOPIFY_DOMAIN!,
    token: process.env.SHOPIFY_MARKETPLACE_TOKEN || process.env.MOODMARKETPLACE_SHOPIFY_ACCESS_TOKEN!,
  },
];

// Une boutique sans cle etait ecartee en silence : ses ventes disparaissaient
// sans le moindre message. On garde desormais la liste des manquantes pour la
// signaler dans la reponse.
const STORES_OK      = STORES.filter(s => s.shop && s.token);
const STORES_SANS_CLE = STORES.filter(s => !s.shop || !s.token).map(s => ({
  name: s.name,
  manque: !s.shop && !s.token ? "adresse et cle" : (!s.shop ? "adresse" : "cle"),
}));

async function shopifyGet(shop: string, token: string, path: string) {
  const res = await fetch(`https://${shop}/admin/api/${API_V}${path}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) throw new Error(`Shopify ${res.status} on ${shop}${path}`);
  return res.json();
}

async function processStore(
  shop: string,
  token: string,
  storeName: string,
  start: string,
  end: string
): Promise<{ ecritures: Ecriture[]; payouts: number; orders: number; error?: string }> {
  try {
    const data = await shopifyGet(shop, token,
      `/shopify_payments/payouts.json?date_min=${start}&date_max=${end}&limit=250`
    ) as { payouts?: Record<string, unknown>[] };

    const payouts = data.payouts ?? [];
    if (payouts.length === 0) return { ecritures: [], payouts: 0, orders: 0 };

    const allTxs: Record<string, unknown>[] = [];
    const payoutMeta = new Map<number, { date: string; amount: number }>();

    for (const payout of payouts) {
      const payoutId     = payout.id as number;
      const payoutDate   = String(payout.date ?? "").slice(0, 10);
      const payoutAmount = Number(payout.amount ?? 0);
      payoutMeta.set(payoutId, { date: payoutDate, amount: payoutAmount });

      const txData = await shopifyGet(shop, token,
        `/shopify_payments/payouts/${payoutId}/transactions.json?limit=250`
      ) as { transactions?: Record<string, unknown>[] };
      allTxs.push(...(txData.transactions ?? []));
    }

    // Batch-fetch pays de facturation + nom de commande
    const orderIds = [...new Set(
      allTxs.filter(tx => tx.source_order_id != null).map(tx => tx.source_order_id as number)
    )];

    const countryMap = new Map<number, string>();
    const nameMap    = new Map<number, string>();

    for (let i = 0; i < orderIds.length; i += 250) {
      const chunk = orderIds.slice(i, i + 250);
      const orders = await shopifyGet(shop, token,
        `/orders.json?ids=${chunk.join(",")}&fields=id,name,billing_address&status=any&limit=250`
      ) as { orders?: Record<string, unknown>[] };
      for (const o of orders.orders ?? []) {
        const billing = o.billing_address as Record<string, unknown> | null;
        countryMap.set(o.id as number, String(billing?.country_code ?? "").toUpperCase());
        nameMap.set(o.id as number, String(o.name ?? "").replace("#", ""));
      }
    }

    const ecritures: Ecriture[] = [];

    for (const tx of allTxs) {
      const type = String(tx.type ?? "").toLowerCase();
      if (!["charge", "refund", "adjustment"].includes(type)) continue;

      const amount     = Math.abs(Number(tx.amount ?? 0));
      const fee        = Math.abs(Number(tx.fee ?? 0));
      const payoutId   = tx.payout_id as number;
      const payoutDate = payoutMeta.get(payoutId)?.date ?? start;
      const date       = String(tx.processed_at ?? payoutDate).slice(0, 10);
      const orderId    = tx.source_order_id as number | null;
      const orderName  = orderId ? nameMap.get(orderId) : undefined;
      const libelle    = orderName ? `Shopify ${orderName}` : `Shopify payout-${payoutId}`;
      const isCH       = (countryMap.get(orderId ?? 0) ?? "") === "CH";
      const { ht, tva } = calculTva(amount);

      if (type === "charge") {
        if (isCH) {
          ecritures.push(...formatEcriture(date, libelle, amount, COMPTES.VENTE_GEN, fee, "CH", COMPTES.PASSAGE_SHOPIFY));
        } else {
          // Client hors Suisse : pas de TVA suisse, et vente rangee dans "Ventes a l'etranger"
          ecritures.push({ date, compte: COMPTES.PASSAGE_SHOPIFY, libelle, montant: amount });
          ecritures.push({ date, compte: COMPTES.VENTE_ETRANGER, libelle, montant: -amount });
          if (fee > 0) {
            ecritures.push({ date, compte: COMPTES.FRAIS, libelle: `Frais ${libelle}`, montant: fee });
            ecritures.push({ date, compte: COMPTES.PASSAGE_SHOPIFY, libelle: `Frais ${libelle}`, montant: -fee });
          }
          void ht; void tva;
        }
      } else if (type === "refund") {
        if (isCH) {
          ecritures.push({ date, compte: COMPTES.PASSAGE_SHOPIFY, libelle: `Rembt ${libelle}`, montant: -amount });
          ecritures.push({ date, compte: COMPTES.VENTE_GEN, libelle: `Rembt ${libelle} HT`, montant: ht });
          ecritures.push({ date, compte: COMPTES.TVA_VENTE, libelle: `Rembt ${libelle} TVA`, montant: tva });
        } else {
          ecritures.push({ date, compte: COMPTES.PASSAGE_SHOPIFY, libelle: `Rembt ${libelle}`, montant: -amount });
          ecritures.push({ date, compte: COMPTES.VENTE_ETRANGER, libelle: `Rembt ${libelle}`, montant: amount });
        }
      } else {
        ecritures.push({ date, compte: COMPTES.PASSAGE_SHOPIFY, libelle, montant: amount > 0 ? amount : -Math.abs(amount) });
        ecritures.push({ date, compte: COMPTES.VENTE_GEN, libelle, montant: amount > 0 ? -amount : Math.abs(amount) });
      }
    }

    // Le virement du payout vers la banque n'est PAS enregistré ici : il arrive par
    // l'import du relevé PostFinance (CRDT "stripe payments" → 100101 / 220006).
    // Deux sources pour la même écriture = doublons dès qu'une période est rejouée.

    return { ecritures, payouts: payouts.length, orders: orderIds.length };
  } catch (err) {
    const msg = String(err);
    // Scope manquant → signaler sans bloquer les autres boutiques
    if (msg.includes("read_shopify_payments_payouts")) {
      return { ecritures: [], payouts: 0, orders: 0, error: `${storeName}: permission read_shopify_payments_payouts manquante` };
    }
    return { ecritures: [], payouts: 0, orders: 0, error: `${storeName}: ${msg.slice(0, 100)}` };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end   = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start et end requis" }, { status: 400 });

  // Traiter toutes les boutiques en parallèle
  const results = await Promise.all(
    STORES_OK.map(s => processStore(s.shop, s.token, s.name, start, end))
  );

  const ecritures = results.flatMap(r => r.ecritures);
  const errors    = results.filter(r => r.error).map(r => r.error);
  const totalPayouts = results.reduce((s, r) => s + r.payouts, 0);
  const totalOrders  = results.reduce((s, r) => s + r.orders, 0);

  const alertes = [
    ...errors,
    ...STORES_SANS_CLE.map(s =>
      `${s.name} : boutique NON traitee, il manque son ${s.manque}. Ses ventes ne sont PAS dans ce fichier.`
    ),
  ];

  return NextResponse.json({
    ecritures,
    payouts: totalPayouts,
    orders_fetched: totalOrders,
    stores: STORES.map(s => {
      const i = STORES_OK.findIndex(o => o.name === s.name);
      return i === -1
        ? { name: s.name, traitee: false, payouts: 0, error: `cle ou adresse manquante` }
        : { name: s.name, traitee: true, payouts: results[i].payouts, error: results[i].error };
    }),
    couverture: {
      boutiques_attendues: STORES.length,
      boutiques_traitees: STORES_OK.length,
      complet: STORES_SANS_CLE.length === 0 && errors.length === 0,
      avertissement: alertes.length
        ? "Toutes les boutiques n'ont pas ete traitees : ne passe pas ces ecritures avant d'avoir corrige."
        : null,
    },
    ...(alertes.length > 0 ? { warnings: alertes } : {}),
  });
}
