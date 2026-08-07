import { NextRequest, NextResponse } from "next/server";
import { loadReassortDataForSupplier } from "@/lib/reassort-katana";

// Lecture des 90 jours de mouvements = ~73 paquets de 250 (18 000 lignes, ~90s).
// Gardée 10 minutes en mémoire : le fournisseur suivant est quasi immédiat.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { supplierId, supplierName } = (await req.json()) as {
      supplierId?: number;
      supplierName?: string;
    };
    if (!supplierId) {
      return NextResponse.json({ error: "Aucun fournisseur choisi" }, { status: 400 });
    }
    const result = await loadReassortDataForSupplier(supplierId, supplierName ?? `#${supplierId}`);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
