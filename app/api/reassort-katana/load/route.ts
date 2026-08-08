import { NextRequest, NextResponse } from "next/server";
import {
  loadReassortDataForSupplier,
  loadMovements,
  loadRecipeIndex,
  loadRecentProductDemand,
  windowsForSupplier,
} from "@/lib/reassort-katana";

// Katana n'accepte que 60 demandes par minute. Tout faire d'un coup dépassait les
// 300 secondes autorisées (constaté en production le 08.08.2026). Le travail est donc
// découpé en étapes appelées l'une après l'autre par l'écran : chacune remplit une
// partie de la mémoire de travail, gardée 10 minutes et partagée par tous les
// fournisseurs. Seule la dernière étape assemble le résultat.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { supplierId, supplierName, step } = (await req.json()) as {
      supplierId?: number;
      supplierName?: string;
      step?: "mouvements" | "recettes" | "commandes" | "final";
    };
    if (!supplierId) {
      return NextResponse.json({ error: "Aucun fournisseur choisi" }, { status: 400 });
    }
    const name = supplierName ?? `#${supplierId}`;

    switch (step) {
      case "mouvements": {
        const windows = windowsForSupplier(name);
        const { read } = await loadMovements(windows[2]);
        return NextResponse.json({ step, read, days: windows[2] });
      }
      case "recettes": {
        const index = await loadRecipeIndex();
        return NextResponse.json({ step, materials: index.size });
      }
      case "commandes": {
        const demand = await loadRecentProductDemand();
        return NextResponse.json({ step, products: demand.size });
      }
      default:
        return NextResponse.json(await loadReassortDataForSupplier(supplierId, name));
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
