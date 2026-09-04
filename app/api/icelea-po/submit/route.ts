import { NextRequest, NextResponse, after } from "next/server";
import { createKatanaPOWithRows, mergeRowsIntoPO } from "@/lib/katana";
import { setIceleaTags, getOrderById } from "@/lib/shopify";
import { getKlaviyoProfileLocale, generateBackorderEmailMulti, generateFollowUpEmailMulti, sendViaKlaviyo } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Concurrency limiter — runs tasks with at most `limit` in parallel
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function formatDeliveryDate(dateStr: string | null | undefined): string {
  const d = dateStr ? new Date(dateStr) : (() => { const n = new Date(); n.setDate(n.getDate() + 21); return n; })();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

type SubmitItem = {
  variantId: number;
  variantName: string;
  variantSku: string | null;
  quantity: number;
  pricePerUnit: number;
};

export async function POST(req: NextRequest) {
  try {
    type ScannedPair = { orderId: number; productId: number; productName: string };

    const body = await req.json() as {
      supplierId: number;
      supplierName: string;
      items: SubmitItem[];
      shopifyOrderIds?: number[];
      scannedPairs?: ScannedPair[];
      expectedArrival?: string | null;
      targetPoId?: number | null;
      sendEmails?: boolean;
    };

    const { supplierId, supplierName, items, shopifyOrderIds, scannedPairs, expectedArrival, targetPoId } = body;
    const sendEmails = body.sendEmails !== false; // par défaut on envoie, comme avant

    if (!supplierId || !items?.length) {
      return NextResponse.json({ error: "supplierId et items requis" }, { status: 400 });
    }

    // Deux modes :
    //   - targetPoId fourni → fusionner les articles scannés dans un bon de commande
    //     existant (réassort) : quantité additionnée si déjà présent, sinon nouvelle ligne.
    //   - sinon → créer un nouveau bon de commande.
    let po: { id: number; number: string; deliveryDate: string | null };
    let mergeSummary: { increased: number; added: number } | null = null;
    if (targetPoId) {
      const m = await mergeRowsIntoPO(
        targetPoId,
        items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, pricePerUnit: i.pricePerUnit }))
      );
      po = { id: m.id, number: m.poNumber, deliveryDate: m.deliveryDate };
      mergeSummary = { increased: m.increased, added: m.added };
    } else {
      po = await createKatanaPOWithRows(
        supplierId,
        items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, pricePerUnit: i.pricePerUnit })),
        expectedArrival
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
      const totalCost = items.reduce((sum, i) => sum + i.quantity * i.pricePerUnit, 0);

      const itemRows = items
        .map(
          (item) =>
            `<tr>
              <td style="padding:5px 0;border-bottom:1px solid #f0f0f0">${item.variantName}</td>
              <td style="padding:5px 8px;border-bottom:1px solid #f0f0f0;color:#555">${item.variantSku ?? "—"}</td>
              <td style="padding:5px 0;border-bottom:1px solid #f0f0f0;text-align:right">${item.quantity}</td>
              <td style="padding:5px 0 5px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${item.pricePerUnit.toFixed(2)}</td>
              <td style="padding:5px 0 5px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${(item.quantity * item.pricePerUnit).toFixed(2)}</td>
            </tr>`
        )
        .join("");

      const html = `
        <div style="font-family:sans-serif;max-width:600px;color:#111">
          <h2 style="margin-bottom:4px">📦 Bon de commande Icelea créé</h2>
          <p style="color:#555;margin-top:0">
            Fournisseur : <strong>${supplierName}</strong> &nbsp;—&nbsp;
            PO n° <strong>${po.number}</strong>
          </p>
          <table style="border-collapse:collapse;width:100%;margin-top:16px">
            <thead>
              <tr style="border-bottom:2px solid #111">
                <th style="padding:5px 0;text-align:left;font-weight:600">Article</th>
                <th style="padding:5px 8px;text-align:left;font-weight:600">SKU</th>
                <th style="padding:5px 0;text-align:right;font-weight:600">Qté</th>
                <th style="padding:5px 0 5px 8px;text-align:right;font-weight:600">Prix/u</th>
                <th style="padding:5px 0 5px 8px;text-align:right;font-weight:600">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding:8px 0;font-weight:600">Total</td>
                <td style="padding:8px 0;text-align:right;font-weight:600">${totalQty}</td>
                <td></td>
                <td style="padding:8px 0 8px 8px;text-align:right;font-weight:600">CHF ${totalCost.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <p style="margin-top:20px;color:#888;font-size:12px">
            ${new Date().toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })}
          </p>
        </div>
      `;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "katana@yourmood.net",
          to: "philippe@yourmood.net",
          subject: `📦 PO Icelea ${po.number} — ${items.length} réf. · CHF ${totalCost.toFixed(2)}`,
          html,
        }),
      });
    }

    // Tag all linked Shopify orders with PO number and estimated delivery date
    // Tags are added sequentially per order to avoid read-modify-write race condition
    if (shopifyOrderIds?.length) {
      const deliveryFormatted = formatDeliveryDate(po.deliveryDate);
      await Promise.allSettled(
        shopifyOrderIds.map((orderId) => setIceleaTags(orderId, po.number, deliveryFormatted))
      );
    }

    // Emails are sent after the response to avoid Vercel timeout with 100+ orders
    const pairsSnapshot = scannedPairs ?? [];
    const poSnapshot = { ...po };
    const supplierNameSnapshot = supplierName;

    console.log(`[icelea-po/submit] scannedPairs: ${pairsSnapshot.length}`, JSON.stringify(pairsSnapshot));

    // Persist pairs to Supabase so they can be resent later without rescanning
    if (pairsSnapshot.length) {
      const { error: insertError } = await supabaseAdmin.from("icelea_po_pairs").insert(
        pairsSnapshot.map((p) => ({
          po_number: po.number,
          po_id: po.id,
          order_id: p.orderId,
          product_id: p.productId,
          product_name: p.productName,
        }))
      );
      if (insertError) console.error("[icelea-po/submit] Supabase insert failed:", insertError.message);
    }

    if (pairsSnapshot.length && sendEmails) {
      after(async () => {
        console.log(`[icelea-po/submit] after() — processing ${pairsSnapshot.length} email(s)`);
        const uniqueOrderIds = [...new Set(pairsSnapshot.map((p) => p.orderId))];

        // Fetch orders 5 at a time to respect Shopify rate limits
        const orderResults = await pLimit(
          uniqueOrderIds.map((id) => () => getOrderById(String(id))),
          5
        );
        const orderMap = new Map<number, Awaited<ReturnType<typeof getOrderById>>>();
        orderResults.forEach((result, i) => {
          if (result.status === "fulfilled") {
            orderMap.set(uniqueOrderIds[i], result.value);
          } else {
            console.error(`[icelea-po/submit] getOrderById(${uniqueOrderIds[i]}) failed:`, result.reason);
          }
        });

        // Locale overrides 5 at a time
        await pLimit(
          Array.from(orderMap.values()).map((order) => async () => {
            const locale = await getKlaviyoProfileLocale(order.customer.email);
            if (locale) order.customer.locale = locale;
          }),
          5
        );

        const needsFollowUp = poSnapshot.deliveryDate
          ? Math.ceil((new Date(poSnapshot.deliveryDate).getTime() - Date.now()) / 86_400_000) > 12
          : false;

        // Group by customer email — one email per customer regardless of how many orders/products
        type CustomerGroup = {
          email: string;
          firstName: string;
          locale: string;
          products: Array<{ productTitle: string; orderId: string }>;
        };
        const customerGroups = new Map<string, CustomerGroup>();

        for (const pair of pairsSnapshot) {
          const order = orderMap.get(pair.orderId);
          if (!order) {
            console.warn(`[icelea-po/submit] skipped order:${pair.orderId} — not in orderMap`);
            continue;
          }
          const key = order.customer.email.toLowerCase();
          if (!customerGroups.has(key)) {
            customerGroups.set(key, {
              email: order.customer.email,
              firstName: order.customer.firstName,
              locale: order.customer.locale,
              products: [],
            });
          }
          customerGroups.get(key)!.products.push({
            productTitle: pair.productName,
            orderId: order.name,
          });
        }

        const customerList = Array.from(customerGroups.values());
        console.log(`[icelea-po/submit] ${customerList.length} customer(s) to notify (grouped from ${pairsSnapshot.length} pairs)`);

        // Process 3 customers at a time (each involves Claude + Klaviyo calls)
        await pLimit(
          customerList.map((cust) => async () => {
            console.log(`[icelea-po/submit] generating email for ${cust.email} (${cust.products.length} product(s))`);
            const [email, followUp] = await Promise.all([
              generateBackorderEmailMulti({
                firstName: cust.firstName,
                locale: cust.locale,
                products: cust.products,
                estimatedDelivery: poSnapshot.deliveryDate ?? null,
                supplierName: supplierNameSnapshot,
              }),
              needsFollowUp ? generateFollowUpEmailMulti({
                firstName: cust.firstName,
                locale: cust.locale,
                products: cust.products,
                estimatedDelivery: poSnapshot.deliveryDate ?? null,
                supplierName: supplierNameSnapshot,
              }) : Promise.resolve(null),
            ]);

            const allProductTitles = cust.products.map((p) => p.productTitle).join(", ");
            const allOrderIds = [...new Set(cust.products.map((p) => p.orderId))].join(", ");

            await sendViaKlaviyo({
              email: cust.email,
              firstName: cust.firstName,
              subject: email.subject,
              greeting: email.greeting,
              body: email.body,
              sign_off: email.sign_off,
              orderId: allOrderIds,
              productTitle: allProductTitles,
              estimatedDelivery: poSnapshot.deliveryDate ?? null,
              supplierName: supplierNameSnapshot,
              followupSubject: followUp?.subject ?? null,
              followupGreeting: followUp?.greeting ?? null,
              followupBody: followUp?.body ?? null,
              followupSignOff: followUp?.sign_off ?? null,
            });
            console.log(`[icelea-po/submit] sent email for ${cust.email}`);
          }),
          3
        );

        console.log(`[icelea-po/submit] after() — done`);
      });
    }

    return NextResponse.json({
      ok: true,
      poId: po.id,
      poNumber: po.number,
      deliveryDate: po.deliveryDate,
      emailsQueued: sendEmails ? pairsSnapshot.length : 0,
      merged: mergeSummary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur" },
      { status: 500 }
    );
  }
}
