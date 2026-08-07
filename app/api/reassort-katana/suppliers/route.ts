import { NextResponse } from "next/server";
import { listReassortSuppliers } from "@/lib/reassort-katana";

export const maxDuration = 120;

export async function GET() {
  try {
    return NextResponse.json({ suppliers: await listReassortSuppliers() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
