"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

type Fichier = { label: string; url: string; filename: string };

type Projet = {
  designId: string;
  matiere: "alu" | "argent";
  date: string;
  prenom?: string;
  email?: string;
  tel?: string;
  message?: string;
  format?: string;
  couleurNom?: string;
  finitionNom?: string;
  taille?: string;
  gravure?: string;
  nbElements?: number;
  pierresCount?: number;
  pierresTotal?: number;
  prix?: number;
  skuComplet?: string;
  cartUrl?: string;
  apercuUrl: string;
  fichiers: Fichier[];
  source: "demande" | "brouillon";
};

type CommandeLiee = {
  numero: string;
  orderId: string;
  date: string;
  paiement?: string;
  expedition?: string;
  client?: string;
  email?: string;
  adminUrl: string;
};

type RechercheCommande = {
  trouve: boolean;
  commande?: CommandeLiee;
  designIds?: string[];
  lignes?: { titre: string; quantite: number; details: { nom: string; valeur: string }[] }[];
};

const FORMAT_LABEL: Record<string, string> = {
  addon: "Addon (7 mm)",
  "2-3": "Deux tiers (4.6 mm)",
  medium: "Medium (2.3 mm)",
  "open-mood": "Open mood (10 mm)",
};

const GRAVURE_LABEL: Record<string, string> = {
  aucune: "Sans gravure",
  simple: "Gravure simple",
  double: "Gravure double",
};

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" });
}

export default function TousLesProjetsPage() {
  const [projets, setProjets] = useState<Projet[] | null>(null);
  const [totaux, setTotaux] = useState<{ total: number; totalAlu: number; totalArgent: number; totalBrouillons: number } | null>(null);
  const [index, setIndex] = useState<Record<string, CommandeLiee[]>>({});
  const [indexEtat, setIndexEtat] = useState<"chargement" | "ok" | "erreur">("chargement");
  const [error, setError] = useState<string | null>(null);

  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<"tous" | "alu" | "argent" | "brouillons">("tous");
  const [rechercheCmd, setRechercheCmd] = useState<RechercheCommande | null>(null);
  const [chercheCmd, setChercheCmd] = useState(false);

  const charger = useCallback(async (refresh = false) => {
    setProjets(null);
    setError(null);
    try {
      const r = await fetch(`/api/admin/projets${refresh ? "?refresh=1" : ""}`);
      const d = await r.json();
      if (d.error) setError(d.error);
      else {
        setProjets(d.projets || []);
        setTotaux({ total: d.total, totalAlu: d.totalAlu, totalArgent: d.totalArgent, totalBrouillons: d.totalBrouillons });
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // Les numéros de commande arrivent en second, sans bloquer l'affichage de la liste
  useEffect(() => {
    fetch("/api/admin/projets/commandes")
      .then((r) => r.json())
      .then((d) => {
        if (d.index) {
          setIndex(d.index);
          setIndexEtat("ok");
        } else setIndexEtat("erreur");
      })
      .catch(() => setIndexEtat("erreur"));
  }, []);

  const texteRecherche = recherche.trim().toLowerCase();

  const resultats = useMemo(() => {
    if (!projets) return [];
    let liste = projets;
    if (filtre === "alu") liste = liste.filter((p) => p.matiere === "alu");
    if (filtre === "argent") liste = liste.filter((p) => p.matiere === "argent");
    if (filtre === "brouillons") liste = liste.filter((p) => p.source === "brouillon");
    if (!texteRecherche) return liste;

    return liste.filter((p) => {
      const cmds = index[p.designId] ?? [];
      const foin = [
        p.prenom, p.email, p.tel, p.taille, p.couleurNom, p.finitionNom, p.skuComplet,
        p.designId, p.message, p.format && (FORMAT_LABEL[p.format] || p.format),
        fmtDate(p.date), (p.date || "").slice(0, 10),
        ...cmds.flatMap((c) => [c.numero, c.client, c.email]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return foin.includes(texteRecherche);
    });
  }, [projets, filtre, texteRecherche, index]);

  // Si le texte ressemble à un numéro de commande et qu'aucun projet ne sort,
  // on va lire la commande directement chez Shopify
  const chercherChezShopify = useCallback(async (numero: string) => {
    setChercheCmd(true);
    setRechercheCmd(null);
    try {
      const r = await fetch(`/api/admin/projets/commandes?commande=${encodeURIComponent(numero)}`);
      setRechercheCmd(await r.json());
    } catch {
      setRechercheCmd({ trouve: false });
    }
    setChercheCmd(false);
  }, []);

  const ressembleNumero = /^#?\d{4,10}$/.test(recherche.trim());

  useEffect(() => {
    if (!ressembleNumero) {
      setRechercheCmd(null);
      return;
    }
    if (projets && resultats.length === 0) {
      const t = setTimeout(() => chercherChezShopify(recherche.trim()), 400);
      return () => clearTimeout(t);
    }
  }, [ressembleNumero, recherche, resultats.length, projets, chercherChezShopify]);

  const projetsTrouvesParCommande = useMemo(() => {
    if (!rechercheCmd?.trouve || !projets) return [];
    const ids = new Set(rechercheCmd.designIds ?? []);
    return projets.filter((p) => ids.has(p.designId));
  }, [rechercheCmd, projets]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="text-2xl font-semibold">Tous les projets personnalisés</h1>
          <div className="flex items-center gap-3 text-sm">
            <a href="/admin/devis" className="text-zinc-400 hover:text-zinc-100">Devis en cours →</a>
            <button onClick={() => charger(true)} className="text-zinc-400 hover:text-zinc-100">🔄 Actualiser</button>
          </div>
        </div>
        <p className="text-sm text-zinc-500 mb-6">
          Tous les projets depuis le début — devis en cours, commandes passées et essais restés en brouillon.
          Cherchez par numéro de commande, prénom, email, taille ou date.
        </p>

        {/* Recherche + filtres */}
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Ex. 396238, Marie, marie@exemple.ch, 54, 2026-06-12"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-amber-600"
          />
          <div className="flex gap-2 text-sm">
            {([
              ["tous", `Tous${totaux ? ` (${totaux.total})` : ""}`],
              ["alu", `Aluminium${totaux ? ` (${totaux.totalAlu})` : ""}`],
              ["argent", `Argent${totaux ? ` (${totaux.totalArgent})` : ""}`],
              ["brouillons", `Brouillons${totaux ? ` (${totaux.totalBrouillons})` : ""}`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFiltre(id)}
                className={`px-3 py-2 rounded-lg border ${
                  filtre === id
                    ? "bg-amber-600 border-amber-600 text-white"
                    : "border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {indexEtat === "erreur" && (
          <p className="text-xs text-amber-500/80 mb-4">
            Les numéros de commande ne sont pas remontés pour le moment — la recherche par numéro va quand même
            chercher la commande directement chez Shopify.
          </p>
        )}

        {error && <p className="text-red-400 mb-4">Erreur : {error}</p>}
        {projets === null && !error && <p className="text-zinc-500">Chargement…</p>}

        {/* Résultat de la recherche directe par numéro de commande */}
        {chercheCmd && <p className="text-zinc-500 mb-4">Recherche de la commande chez Shopify…</p>}
        {rechercheCmd && !chercheCmd && (
          <div className="mb-6 border border-amber-700/50 bg-amber-950/20 rounded-xl p-4">
            {!rechercheCmd.trouve ? (
              <p className="text-sm text-zinc-400">
                Aucune commande <strong className="text-zinc-200">{recherche.trim()}</strong> trouvée chez Shopify.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h2 className="font-semibold">Commande {rechercheCmd.commande?.numero}</h2>
                  <span className="text-xs text-zinc-500">{fmtDate(rechercheCmd.commande?.date)}</span>
                  {rechercheCmd.commande?.client && <span className="text-xs text-zinc-400">{rechercheCmd.commande.client}</span>}
                  <a href={rechercheCmd.commande?.adminUrl} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">
                    Ouvrir dans Shopify ↗
                  </a>
                </div>

                {projetsTrouvesParCommande.length > 0 ? (
                  <p className="text-sm text-emerald-400">
                    Projet retrouvé — il est affiché ci-dessous avec son dessin.
                  </p>
                ) : (rechercheCmd.designIds?.length ?? 0) > 0 ? (
                  <div className="text-sm text-zinc-300">
                    <p className="mb-2">Le dessin de cette commande est disponible ici :</p>
                    <div className="flex flex-wrap gap-2">
                      {rechercheCmd.designIds!.map((id) =>
                        id.startsWith("argent_") ? (
                          ["complet", "gravure", "plan"].map((t) => (
                            <a
                              key={`${id}-${t}`}
                              href={`/api/design-argent/${id}/${t}`}
                              download={`commande-${rechercheCmd.commande?.numero}-${t}.svg`}
                              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs"
                            >
                              📥 {t}
                            </a>
                          ))
                        ) : (
                          <a
                            key={id}
                            href={`/api/design/${id}`}
                            download={`commande-${rechercheCmd.commande?.numero}.svg`}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs"
                          >
                            📥 Télécharger le dessin
                          </a>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400">
                    <p>Cette commande ne porte aucun lien de dessin. Détail des lignes :</p>
                    <ul className="mt-2 space-y-1">
                      {(rechercheCmd.lignes ?? []).map((l, i) => (
                        <li key={i} className="text-xs">
                          <span className="text-zinc-200">{l.quantite}× {l.titre}</span>
                          {l.details.length > 0 && (
                            <span className="text-zinc-500"> — {l.details.map((d) => `${d.nom} : ${d.valeur}`).join(" · ")}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {projets && (
          <p className="text-sm text-zinc-400 mb-4">
            {resultats.length} projet{resultats.length > 1 ? "s" : ""} affiché{resultats.length > 1 ? "s" : ""}
            {texteRecherche && projets.length > 0 && ` sur ${projets.length}`}
            {indexEtat === "chargement" && " · numéros de commande en cours de chargement…"}
          </p>
        )}

        <div className="grid gap-4">
          {(projetsTrouvesParCommande.length > 0 ? projetsTrouvesParCommande : resultats).map((p) => {
            const cmds = index[p.designId] ?? [];
            return (
              <div key={p.designId} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row gap-4">
                {/* Aperçu — fond gris pour que les traits blancs ET noirs restent visibles */}
                <div
                  className="rounded-lg p-3 md:w-72 flex items-center justify-center border border-zinc-700 shrink-0"
                  style={{ aspectRatio: "3/1", background: "linear-gradient(135deg, #d8d8d8, #b8b8b8)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.apercuUrl}
                    alt="Dessin du projet"
                    className="max-w-full max-h-full"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>

                {/* Infos */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-semibold text-zinc-100">{p.prenom || "Sans prénom"}</h3>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      p.matiere === "argent"
                        ? "border-zinc-500 text-zinc-300"
                        : "border-amber-700 text-amber-400"
                    }`}>
                      {p.matiere === "argent" ? "Argent 925" : "Aluminium"}
                    </span>
                    {p.source === "brouillon" && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-500">
                        Brouillon (aucune demande enregistrée)
                      </span>
                    )}
                    {cmds.map((c) => (
                      <a
                        key={c.numero}
                        href={c.adminUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700 text-emerald-300 hover:bg-emerald-900/70"
                        title={`${c.paiement ?? ""} ${c.expedition ?? ""}`.trim()}
                      >
                        Commande {c.numero} ↗
                      </a>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">{fmtDate(p.date)}</p>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {p.email && (
                      <div className="truncate">
                        <span className="text-zinc-500">Email :</span>{" "}
                        <a href={`mailto:${p.email}`} className="text-amber-400 hover:underline">{p.email}</a>
                      </div>
                    )}
                    {p.tel && <div><span className="text-zinc-500">Tél :</span> {p.tel}</div>}
                    {p.format && <div><span className="text-zinc-500">Format :</span> {FORMAT_LABEL[p.format] || p.format}</div>}
                    {p.couleurNom && <div><span className="text-zinc-500">Couleur :</span> {p.couleurNom}</div>}
                    {p.finitionNom && <div><span className="text-zinc-500">Finition :</span> {p.finitionNom}</div>}
                    {p.taille && <div><span className="text-zinc-500">Taille :</span> <strong className="text-amber-400">{p.taille}</strong></div>}
                    {p.gravure && <div><span className="text-zinc-500">Gravure :</span> {GRAVURE_LABEL[p.gravure] || p.gravure}</div>}
                    {p.nbElements != null && <div><span className="text-zinc-500">Éléments :</span> {p.nbElements}</div>}
                    {p.pierresCount != null && p.pierresCount > 0 && (
                      <div><span className="text-zinc-500">Pierres :</span> {p.pierresCount}{p.pierresTotal ? ` (${p.pierresTotal} CHF)` : ""}</div>
                    )}
                    {p.prix != null && <div><span className="text-zinc-500">Prix :</span> {p.prix} CHF</div>}
                    {p.skuComplet && <div className="col-span-2 truncate"><span className="text-zinc-500">SKU :</span> {p.skuComplet}</div>}
                    {p.message && (
                      <div className="col-span-2 mt-1">
                        <span className="text-zinc-500">Message :</span> <em className="text-zinc-300">{p.message}</em>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="md:w-48 flex flex-col gap-2 shrink-0">
                  {p.fichiers.map((f) => (
                    <a
                      key={f.url}
                      href={f.url}
                      download={f.filename}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-2 rounded-lg text-sm text-center"
                    >
                      📥 {f.label}
                    </a>
                  ))}
                  <a
                    href={p.apercuUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="border border-zinc-700 hover:bg-zinc-800 text-zinc-300 px-3 py-2 rounded-lg text-sm text-center"
                  >
                    👁️ Voir en grand
                  </a>
                  {p.cartUrl && (
                    <a
                      href={p.cartUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="border border-zinc-700 hover:bg-zinc-800 text-zinc-400 px-3 py-2 rounded-lg text-xs text-center"
                    >
                      Lien de paiement client ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {projets && resultats.length === 0 && !rechercheCmd && !chercheCmd && (
          <p className="text-zinc-500">Aucun projet ne correspond à cette recherche.</p>
        )}
      </div>
    </div>
  );
}
