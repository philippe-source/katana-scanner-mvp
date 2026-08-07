import { NextRequest, NextResponse } from "next/server";
import {
  getAllKatanaSuppliers,
  getKatanaVariantsBySkus,
  createKatanaPOWithRows,
} from "@/lib/katana";

export const maxDuration = 300;

type POItem = { sku: string; name: string; quantity: number; supplierName: string };

function norm(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

// Tri des lignes du bon de commande (demandé Philippe le 07.08.2026) :
// 1. type d'addon, 2. couleur, 3. taille. Référence Coloral = MTRL-{TYPE}-{TAILLE}-{COULEUR}.
// Une référence d'une autre forme garde un tri alphabétique et passe en fin de liste.
// MTRL-23ALU-BI-66-ROSE existe : la taille n'est pas toujours au même rang. On la cherche
// sur le premier morceau numérique ; sans taille lisible, la ligne passe en fin de sa couleur.
function coloralSortKey(sku: string): { type: string; color: string; size: number } | null {
  const parts = (sku ?? "").trim().toUpperCase().split("-");
  if (parts[0] !== "MTRL" || parts.length < 4) return null;
  const sizeAt = parts.findIndex((p, i) => i >= 2 && /^\d+$/.test(p));
  const size = sizeAt === -1 ? Number.MAX_SAFE_INTEGER : Number(parts[sizeAt]);
  const color = parts.filter((_, i) => i >= 2 && i !== sizeAt).join("-");
  return { type: parts[1], color, size };
}

function sortPoItems(items: POItem[]): POItem[] {
  return [...items].sort((a, b) => {
    const ka = coloralSortKey(a.sku);
    const kb = coloralSortKey(b.sku);
    if (!ka && !kb) return a.sku.localeCompare(b.sku);
    if (!ka) return 1;
    if (!kb) return -1;
    if (ka.type !== kb.type) return ka.type.localeCompare(kb.type);
    if (ka.color !== kb.color) return ka.color.localeCompare(kb.color);
    return ka.size - kb.size;
  });
}

// POST { items: POItem[], expectedArrival?: string }
//   → { pos: [{ supplierName, poNumber, poId, katanaUrl, lineCount, totalQty }], unresolvedSkus, unmatchedSuppliers }
export async function POST(req: NextRequest) {
  try {
    const { items, expectedArrival } = (await req.json()) as {
      items: POItem[];
      expectedArrival?: string | null;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Aucune ligne à commander" }, { status: 400 });
    }

    // 1. Resolve supplier names → Katana supplier ids
    const suppliers = await getAllKatanaSuppliers();
    const supplierByName = new Map(suppliers.map((s) => [norm(s.name), s]));

    // 2. Resolve ALL SKUs → variant id + purchase price in one grouped call
    //    (Katana = 60 req/min ; un appel par SKU dépasse le quota et provoque un timeout)
    const variantBySku = await getKatanaVariantsBySkus(items.map((it) => it.sku));

    // 3. Group items by supplier name
    const groups = new Map<string, POItem[]>();
    for (const it of items) {
      const key = it.supplierName || "(sans fournisseur)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }

    const pos: {
      supplierName: string;
      poNumber: string;
      poId: number;
      katanaUrl: string;
      lineCount: number;
      totalQty: number;
    }[] = [];
    const unresolvedSkus: string[] = [];
    const unmatchedSuppliers: string[] = [];

    for (const [supplierName, groupItems] of groups) {
      const supplier = supplierByName.get(norm(supplierName));
      if (!supplier) {
        unmatchedSuppliers.push(supplierName);
        continue;
      }

      // 4. Build PO rows from the pre-resolved variant map, triées type → couleur → taille
      const rows: { variantId: number; quantity: number; pricePerUnit: number }[] = [];
      for (const it of sortPoItems(groupItems)) {
        const variant = variantBySku.get(it.sku);
        if (!variant) {
          unresolvedSkus.push(it.sku);
          continue;
        }
        rows.push({
          variantId: variant.id,
          quantity: Math.round(it.quantity),
          pricePerUnit: variant.purchasePrice ?? 0,
        });
      }

      if (rows.length === 0) continue;

      // 5. Create the purchase order(s) in Katana.
      //    Katana plante (431 puis 500) à partir de ~296 lignes par commande
      //    (testé : 295 OK, 299 KO) → on découpe à 250 lignes max (marge ~45).
      const MAX_ROWS = 250;
      for (let i = 0; i < rows.length; i += MAX_ROWS) {
        const chunk = rows.slice(i, i + MAX_ROWS);
        const po = await createKatanaPOWithRows(
          supplier.id,
          chunk,
          expectedArrival ?? null,
          "RA"
        );
        pos.push({
          supplierName,
          poNumber: po.number,
          poId: po.id,
          katanaUrl: `https://app.katanamrp.com/purchase-orders/${po.id}`,
          lineCount: chunk.length,
          totalQty: chunk.reduce((s, r) => s + r.quantity, 0),
        });
      }
    }

    return NextResponse.json({ pos, unresolvedSkus, unmatchedSuppliers });
  } catch (err) {
    console.error("[reassort-po] ERROR:", err instanceof Error ? err.stack ?? err.message : err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur" },
      { status: 500 }
    );
  }
}
