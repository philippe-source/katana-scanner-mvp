import { readFileSync } from "fs";
import path from "path";

// Page PUBLIQUE — Le Grand Concours Mood (clientes, sans login).
// Public via la règle dédiée dans middleware.ts. L'espace mood est protégé par code côté API.
export async function GET() {
  const html = readFileSync(path.join(process.cwd(), "html/concours.html"), "utf-8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
