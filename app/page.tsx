import Link from "next/link";

type Tool = {
  href: string;
  emoji: string;
  title: string;
  description: string;
};

const sections: { id: string; title: string; summary: string; tools: Tool[] }[] = [
  {
    id: "atelier",
    title: "Outils Atelier",
    summary: "Production, impression des bons, rassemblement des commandes et ordres d'achat Icelea.",
    tools: [
      {
        href: "/scanner",
        emoji: "📦",
        title: "Scanner atelier",
        description: "Scannez un produit Shopify pour voir sa recette Katana et lancer une production.",
      },
      {
        href: "/reprint",
        emoji: "🖨️",
        title: "Réimpression",
        description: "Réimprimez le bon de fabrication d'une commande existante, par processus ou en mode complet.",
      },
      {
        href: "/rassemblement",
        emoji: "🗂️",
        title: "Rassemblement",
        description: "Préparez une commande article par article. Coffrets et packs gérés avec compteur progressif.",
      },
      {
        href: "/fulfillment",
        emoji: "✅",
        title: "Fulfillment",
        description: "Fulfillment rapide par scanner : articles expédiés, numéro de suivi Swiss Post, validation en quelques secondes.",
      },
      {
        href: "/icelea-po",
        emoji: "🛒",
        title: "Commande Icelea",
        description: "Créez un ordre d'achat Icelea depuis Katana : scan produit, choix taille, confirmation ingrédients.",
      },
      {
        href: "/icelea-prix",
        emoji: "💲",
        title: "Prix Icelea",
        description: "Upload la facture PDF Icelea, compare avec Katana, applique les nouveaux prix d'achat et génère le CSV Shopify pour les articles avec hausse >5%.",
      },
      {
        href: "/icelea-arrivage",
        emoji: "📥",
        title: "Arrivage Icelea",
        description: "Facture PDF → liste de réception avec code-barres, scan pour réceptionner les PO (FIFO partiel) + picking, et rapport de fin FR/EN. Arrivage reprenable en plusieurs fois.",
      },
      {
        href: "/reassort",
        emoji: "📦",
        title: "Réassort fournisseurs",
        description: "Calculez les quantités à commander par fournisseur à partir des exports Katana 7j / 30j / 90j. Mode volatil ou continu.",
      },
    ],
  },
  {
    id: "creation",
    title: "Création de produits",
    summary: "Mise en ligne Shopify, bundles CSV et édition des recettes Katana.",
    tools: [
      {
        href: "/product-creator",
        emoji: "💍",
        title: "Créer un produit Shopify",
        description: "Créez un produit, un coffret ou un pack directement dans Shopify : SKU, variantes, SEO et photos en un formulaire.",
      },
      {
        href: "/bundles",
        emoji: "🎁",
        title: "Générateur de bundles",
        description: "Créez les CSV d'import pour Simple Bundles & Kits, variant par variant, avec filtre par option.",
      },
      {
        href: "/recipes",
        emoji: "⚗️",
        title: "Éditeur de recettes",
        description: "Consultez et éditez les recettes de fabrication Katana sans passer par l'application.",
      },
      {
        href: "/katana-generator",
        emoji: "🏭",
        title: "Générateur fichiers Katana",
        description: "Upload ton CSV Shopify → l'app croise avec ton catalogue de 2 208 MTRL et génère les 2 Excel Katana (Products + Recipes) prêts à importer.",
      },
    ],
  },
  {
    id: "insights",
    title: "Insights clientes",
    summary: "Sondages et collecte d'idées clientes pour orienter les prochaines pépites, coffrets et pièces joaillerie.",
    tools: [
      {
        href: "/sondage/admin",
        emoji: "💌",
        title: "Sondage pépites",
        description: "Tableau de bord du sondage clientes : lien vers le Google Sheet en temps réel, rappel code Shopify MERCIAVOUS20. Sondage public sur /sondage.",
      },
      {
        href: "/moodboards",
        emoji: "💎",
        title: "Moodboards clientes",
        description: "Fiches clientes intéressées par la joaillerie + Top clientes Shopify. Univers, palette, photos et notes modifiables et partagés par toute l'équipe.",
      },
      {
        href: "/projet-joaillerie/admin",
        emoji: "🎁",
        title: "Demandes projet joaillerie",
        description: "Les demandes de projet sur-mesure remplies par les clientes (formulaire public sur /projet-joaillerie). Univers, matière, pierres, histoire + images d'inspiration.",
      },
    ],
  },
  {
    id: "boutiques",
    title: "Outils Boutiques",
    summary: "Inventaire en boutique et correction de fulfillments pour les équipes en point de vente.",
    tools: [
      {
        href: "/stock",
        emoji: "📊",
        title: "Scanner stock",
        description: "Inventaire rapide par scan : comptez les unités, suivez les batches de production, gérez les délais fournisseurs.",
      },
      {
        href: "/unfulfill",
        emoji: "↩️",
        title: "Unfulfill",
        description: "Annulez un fulfillment pour corriger une erreur d'expédition ou relancer la production d'un article.",
      },
    ],
  },
  {
    id: "finance",
    title: "Finance & Comptabilité",
    summary: "Export des écritures comptables pour WinEUR GIT depuis toutes les sources de paiement.",
    tools: [
      {
        href: "/wineur",
        emoji: "📊",
        title: "WinEUR Hub",
        description: "Génère un fichier d'écritures WinEUR depuis SumUp, PayPal, Shopify Payouts, PostFinance et Twint pour une période donnée.",
      },
    ],
  },
  {
    id: "stats",
    title: "Stats & Conditions",
    summary: "Analyse des stats hebdomadaires MasterTech, identification de condition et Battle Plan personnalisé.",
    tools: [
      {
        href: "/stats-conditions",
        emoji: "📈",
        title: "Analyser mes stats",
        description: "Uploadez une capture MasterTech, obtenez la condition (Affluence, Urgence…), le plan d'action et un Battle Plan jeudi→mercredi.",
      },
    ],
  },
  {
    id: "rd",
    title: "R&D & Création",
    summary: "Pipeline de création produits, planning annuel et brainstorm IA.",
    tools: [
      {
        href: "/r-and-d",
        emoji: "🎨",
        title: "Pipeline R&D",
        description: "Calendrier annuel jeudi→mercredi pour planifier les nouveautés. Suivi des 9 étapes (idée → mise en ligne) + objectifs CA mensuels par produit.",
      },
      {
        href: "/carnet",
        emoji: "📓",
        title: "Le Carnet des nouveautés",
        description: "Le dictionnaire de fabrication Mood : chaque création a sa fiche, classée par mois et par collection, avec photos, tags et lien vers la fiche Shopify.",
      },
      {
        href: "/design-creator",
        emoji: "💡",
        title: "Création design Mood",
        description: "Donne ton croquis ou ton idée en mots : visualisation photo-réaliste de la bague mood (base + addon + finition). Pour explorer un design avant prototype.",
      },
      {
        href: "/joaillerie/creation-du-mois",
        emoji: "✨",
        title: "La création du mois",
        description: "Génère une page vitrine pour ta collection mensuelle (Mood Joaillerie ou Mood Collection). Thème visuel généré par IA, cards produits stylées avec hover + prix + lien vers la fiche Shopify native, preview + push draft ou publié.",
      },
      {
        href: "/offres",
        emoji: "🎁",
        title: "Offres par nouveauté",
        description: "Vue orientée offres pour Stéphanie : champ libre par produit R&D, synchro auto avec le pipeline. Ventes Shopify de la semaine pour décider en fonction du succès.",
      },
      {
        href: "/retouche",
        emoji: "📷",
        title: "Retouche photo & vidéo IA",
        description: "Upload une photo : fond blanc/anthracite, nettoyage, multi-formats sociaux, bague portée, thèmes saisonniers — et rotation 360° en vidéo MP4 (IA Kling).",
      },
      {
        href: "/visuel-mood",
        emoji: "🎨",
        title: "Visuels Mood",
        description: "Crée un visuel post / story prêt à publier : 4 templates (promo flash, collection lancée, édition limitée, multi-bagues) · fond IA + vrai logo Mood + textes éditables.",
      },
      {
        href: "/mood-studio",
        emoji: "📄",
        title: "Mood Studio (catalogue print)",
        description: "Génère automatiquement des flyers A5 produit prêts à imprimer depuis Shopify : photo + nom + prix + QR code, style Mood Collection. À venir : certificats, dépliants, catalogues.",
      },
      {
        href: "/perso",
        emoji: "🖋️",
        title: "Personnalisation",
        description: "Vectorise les empreintes / dessins clients en SVG dimensionné selon format et taille. Génère le fichier prêt pour Illustrator/Gravograph.",
      },
      {
        href: "/admin/projets",
        emoji: "🗃️",
        title: "Tous les projets perso",
        description: "Tous les projets personnalisés depuis le début (aluminium + argent) : recherche par numéro de commande, prénom, email, taille ou date, aperçu du dessin et téléchargement des fichiers.",
      },
      {
        href: "/admin/devis",
        emoji: "📝",
        title: "Gestion des devis",
        description: "Devis sur mesure en cours (30 derniers jours) : envoi du devis, relance de la cliente, remplacement du design, clôture.",
      },
    ],
  },
  {
    id: "communaute",
    title: "Communauté",
    summary: "Modération et analytics de la Mood Lovers Gallery.",
    tools: [
      {
        href: "/admin/mood-lovers",
        emoji: "🫶",
        title: "Mood Lovers Gallery",
        description: "Valider ou refuser les compos soumises par les clientes. Vue Analytics : top contributeurs, votes, villes, taux de validation.",
      },
    ],
  },
];

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Link
      href={tool.href}
      className="group flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
    >
      <span className="text-xl leading-none mt-0.5 shrink-0">{tool.emoji}</span>
      <div className="min-w-0">
        <p className="font-semibold text-zinc-100 group-hover:text-white text-sm mb-0.5">
          {tool.title}
        </p>
        <p className="text-xs text-zinc-400 leading-relaxed">
          {tool.description}
        </p>
      </div>
      <span className="ml-auto text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0 self-center">
        →
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-12">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <header className="mb-10 max-w-2xl">
          <p className="text-xs font-bold tracking-widest uppercase text-zinc-500 mb-2">
            Mood Collection
          </p>
          <h1 className="text-3xl font-semibold text-zinc-50 mb-3">
            Mood Dashboard
          </h1>
          <p className="text-zinc-400 text-base">
            Tous les outils internes — atelier, produits Shopify, stats et conditions.
          </p>
        </header>

        {/* Table des matières */}
        <nav className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="group rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
            >
              <p className="text-xs font-bold tracking-widest uppercase text-zinc-500 mb-1">
                {s.title}
              </p>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {s.summary}
              </p>
            </a>
          ))}
        </nav>

        {/* Sections — 3 colonnes sur grand écran */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-8">
              <h2 className="text-xs font-bold tracking-widest uppercase text-zinc-500 mb-3">
                {section.title}
              </h2>
              <div className="flex flex-col gap-2.5">
                {section.tools.map((tool) => (
                  <ToolCard key={tool.href + tool.title} tool={tool} />
                ))}
              </div>
            </section>
          ))}
        </div>

      </div>
    </div>
  );
}
