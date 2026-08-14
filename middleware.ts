import { auth } from "@/auth";
import { NextResponse } from "next/server";

const WINEUR_ALLOWED = new Set([
  "philippe@yourmood.net",
  "stephanie@yourmood.net",
  "eric@yourmood.net",
  "eric.chenaux@yourmood.net",
  "fabienne@yourmood.net",
]);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // /sondage (page publique pour clientes) — exclut /sondage/admin
  if (pathname === "/sondage" || (pathname.startsWith("/sondage/") && !pathname.startsWith("/sondage/admin"))) {
    return;
  }

  // /projet-joaillerie (formulaire public clientes) — exclut /projet-joaillerie/admin
  if (pathname === "/projet-joaillerie" || (pathname.startsWith("/projet-joaillerie/") && !pathname.startsWith("/projet-joaillerie/admin"))) {
    return;
  }

  // /armoire (espace client public — Mon Armoire Mood) — exclut /armoire/admin (staff)
  if (pathname === "/armoire" || (pathname.startsWith("/armoire/") && !pathname.startsWith("/armoire/admin"))) {
    return;
  }

  // /pronostics (jeu-concours public clientes — Mondial 2026) — exclut /pronostics/admin (staff)
  if (pathname === "/pronostics" || (pathname.startsWith("/pronostics/") && !pathname.startsWith("/pronostics/admin"))) {
    return;
  }

  // /concours (Le Grand Concours Mood — page publique clientes). L'espace mood est protégé par code côté API.
  if (pathname === "/concours") {
    return;
  }

  // /carnet + son contenu : consultable sans login Google (on envoie le lien, la personne voit tout de suite).
  // L'écriture (créer/éditer les fiches) reste protégée dans /api/carnet lui-même (login + Amila uniquement).
  // L'onglet « Projet Icelea » a sa propre protection par code.
  if (pathname === "/carnet" || pathname === "/api/carnet" || pathname === "/api/carnet/icelea" || pathname === "/api/carnet/icelea-upload" || pathname === "/api/carnet/icelea-stock") {
    return;
  }

  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // /wineur (page) → restreint aux 4 utilisateurs autorisés
  // /api/wineur/* → exclu du middleware (appels internes depuis generate)
  //   mais la page /wineur qui les déclenche est elle protégée
  if (pathname.startsWith("/wineur")) {
    const email = req.auth.user?.email ?? "";
    if (!WINEUR_ALLOWED.has(email)) {
      return new NextResponse("Accès non autorisé", { status: 403 });
    }
  }
});

export const config = {
  matcher: [
    // Protect all routes except auth, login, gorgias webhook, shopify callback, public client perso pages, sondage public, and Next.js internals
    "/((?!api/auth|api/wineur|api/gorgias-webhook|api/orders-webhook|api/produits/shopify-callback|api/creer-demande|api/creer-cart-shopify|api/creer-argent-cart-shopify|api/design|api/design-argent|api/admin|api/quiz-submit|api/mood-lovers|api/sondage|api/pronostics/save|api/projet-joaillerie-submit|api/concours-submit|api/concours-public|api/concours-list|api/concours-detail|api/concours-image|api/concours-action|api/concours-vote|api/armoire/verify|api/armoire/save|api/armoire/unlock|api/armoire/moodailles-list|api/armoire/play|jeu|admin|creer|creer-argent|aluminium|argent|sertissages|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
