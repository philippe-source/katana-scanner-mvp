"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "./styles.css";

type FileRef = { url: string; name: string };
type Addon = {
  id: string; collectionId: string; nom: string;
  format?: string | string[]; matiere?: string; couleur?: string; finition?: string;
  croquis?: string[]; inspi?: string[]; ai?: FileRef[]; gnh?: FileRef[]; photos?: string[]; sertissage?: string[];
  laser?: string; realisation?: string; mtrl?: string; shopify?: string; fournisseur?: string[]; tags?: string[];
  date_croquis?: string; date_dessin?: string; date_gravure?: string; date_sortie?: string;
};
const fdate = (v?: string) => v ? v.split("-").reverse().join(".") : "";
type Collection = { id: string; name: string; month: string; cover?: string; shopify?: string; addons: Addon[] };

const FORMATS = ["addon", "deux tiers", "medium", "mini", "open mood", "base", "pack", "coffret"];
// format peut être une chaîne (ancien) ou un tableau (nouveau) — on lit les deux sans rien perdre
const fmtArr = (v?: string | string[]) => Array.isArray(v) ? v : (v ? String(v).split(/[,·]/).map((s) => s.trim()).filter(Boolean) : []);
const fmtLabel = (v?: string | string[]) => fmtArr(v).join(" · ");
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const MATIERES = ["argent", "acier", "titane", "or", "aluminium", "polymère", "céramique", "bronze"];
const FOURNISSEURS = ["mood gravure mécanique", "mood gravure laser", "bijouterie", "icelea", "vacor"];

async function api(action: string, body: Record<string, unknown> = {}) {
  const r = await fetch("/api/carnet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  return r.json();
}

export default function CarnetPage() {
  const [cols, setCols] = useState<Collection[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [colId, setColId] = useState<string | null>(null);
  const [addonId, setAddonId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "col" | "addon">(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"mois" | "alpha">("mois");
  const [tab, setTab] = useState<"carnet" | "icelea">("carnet");

  // navigation directe (animation de tournage retirée)
  function turnPage(fn: () => void) { fn(); }
  const [draft, setDraft] = useState("");
  const [draft2, setDraft2] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printMonth, setPrintMonth] = useState<{ label: string; items: Collection[] } | null>(null);

  const load = useCallback(() => {
    fetch("/api/carnet").then((r) => r.json()).then((d) => { setCols(d.collections || []); setCanEdit(!!d.canEdit); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(false); setPrintMonth(null); }, 600);
    return () => clearTimeout(t);
  }, [printing]);

  const col = cols.find((c) => c.id === colId) || null;
  const addon = col?.addons.find((a) => a.id === addonId) || null;

  // classement des collections : recherche (nom + mots-clés/détails des addons) + par mois ou A→Z
  const nq = norm(q);
  const filteredCols = cols.filter((c) => {
    if (!nq) return true;
    const hay = norm([
      c.name, c.month,
      ...c.addons.flatMap((a) => [a.nom, a.matiere, a.couleur, a.finition, ...fmtArr(a.format), ...(a.tags || []), ...(a.fournisseur || [])]),
    ].filter(Boolean).join(" "));
    return hay.includes(nq);
  });
  const colGroups: [string, Collection[]][] = (() => {
    const m = new Map<string, Collection[]>();
    const labels = new Map<string, string>(); // clé regroupée -> libellé affiché (le 1er vu)
    const list = mode === "alpha" ? [...filteredCols].sort((a, b) => a.name.localeCompare(b.name, "fr")) : filteredCols;
    for (const c of list) {
      const raw = mode === "alpha" ? (c.name.trim()[0] || "#").toUpperCase() : (c.month?.trim() || "Sans mois");
      // même mois/année = même groupe, peu importe accent, majuscule ou espaces en trop
      const key = mode === "alpha" ? raw : (norm(raw).replace(/\s+/g, " ").trim() || "sans mois");
      if (!m.has(key)) { m.set(key, []); labels.set(key, raw); }
      m.get(key)!.push(c);
    }
    const entries = [...m.entries()].map(([k, v]) => [labels.get(k) || k, v] as [string, Collection[]]);
    // tri des mois dans l'ordre du calendrier (plus récent en haut), « Sans mois » à la fin
    const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const rang = (label: string) => {
      const n = norm(label);
      const mi = MOIS.findIndex((mo) => n.includes(norm(mo)));
      const y = (label.match(/\d{4}/) || [])[0];
      if (mi < 0 && !y) return -1; // "Sans mois" -> fin
      return (y ? parseInt(y) : 0) * 100 + (mi >= 0 ? mi + 1 : 0);
    };
    if (mode === "alpha") entries.sort((a, b) => a[0].localeCompare(b[0], "fr"));
    else entries.sort((a, b) => { const ra = rang(a[0]), rb = rang(b[0]); if (ra < 0) return 1; if (rb < 0) return -1; return rb - ra; });
    return entries;
  })();

  // produits (addons) qui correspondent à la recherche, tous collections confondues
  const matchedAddons = nq
    ? cols.flatMap((c) => c.addons
        .filter((a) => norm([a.nom, a.matiere, a.couleur, a.finition, ...fmtArr(a.format), ...(a.tags || []), ...(a.fournisseur || [])].filter(Boolean).join(" ")).includes(nq))
        .map((a) => ({ a, c })))
    : [];

  function patchAddonLocal(id: string, patch: Partial<Addon>) {
    setCols((prev) => prev.map((c) => ({ ...c, addons: c.addons.map((a) => (a.id === id ? { ...a, ...patch } : a)) })));
  }
  async function saveAddon(id: string, patch: Partial<Addon>) {
    patchAddonLocal(id, patch);
    await api("updateAddon", { id, patch });
  }
  async function deleteAddon(id: string) {
    setCols((prev) => prev.map((c) => ({ ...c, addons: c.addons.filter((a) => a.id !== id) })));
    setAddonId(null);
    await api("deleteAddon", { id });
  }

  async function createCollection() {
    const d = await api("createCollection", { name: draft.trim() || "Sans nom", month: draft2.trim() });
    if (d.collection) { setModal(null); setDraft(""); setDraft2(""); load(); }
  }
  async function deleteCollection(id: string) {
    setCols((prev) => prev.filter((c) => c.id !== id));
    setColId(null); setAddonId(null);
    await api("deleteCollection", { id });
  }
  async function setColCover(id: string, file: File) {
    const u = await uploadFile(file);
    if (!u) return;
    await api("updateCollection", { id, cover: u.url });
    setCols((prev) => prev.map((c) => (c.id === id ? { ...c, cover: u.url } : c)));
  }
  async function saveColShopify(id: string, url: string) {
    await api("updateCollection", { id, shopify: url });
    setCols((prev) => prev.map((c) => (c.id === id ? { ...c, shopify: url } : c)));
  }
  async function saveColField(id: string, patch: { name?: string; month?: string }) {
    setCols((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    await api("updateCollection", { id, ...patch });
  }
  async function createAddon() {
    if (!colId) return;
    const d = await api("createAddon", { collectionId: colId, nom: draft.trim() || "Nouvel addon" });
    if (d.addon) { setModal(null); setDraft(""); load(); setAddonId(d.addon.id); }
  }

  return (
    <div className={"carnet" + (printing ? " printing" : "")}>
      <div className="book">
      <div className="top">
        <h1 className="brand">Le Carnet des <em>nouveautés</em></h1>
      </div>
      <div className="cnav">
        <button className={"cnav-tab" + (tab === "carnet" ? " on" : "")} onClick={() => setTab("carnet")}>Le Carnet</button>
        <button className={"cnav-tab" + (tab === "icelea" ? " on" : "")} onClick={() => setTab("icelea")}>📦 Projet Icelea — Amila</button>
      </div>
      <p className="tagline">Chaque création, sa fiche. Le dictionnaire de fabrication Mood.</p>

      <div className="leaf">
      {tab === "icelea" ? <IceleaBoard /> : (<>
      {loading && <div className="empty">Chargement…</div>}

      {/* VUE COLLECTIONS */}
      {!loading && !colId && (
        <>
          <div className="cbar">
            <div className="search">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (collection, mot-clé, matière…)" />
            </div>
            <div className="modes">
              <button className={mode === "mois" ? "on" : ""} onClick={() => setMode("mois")}>Par mois</button>
              <button className={mode === "alpha" ? "on" : ""} onClick={() => setMode("alpha")}>A→Z</button>
            </div>
            {canEdit && <button className="btn sm" onClick={() => { setModal("col"); setDraft(""); setDraft2(""); }}>+ Nouvelle collection</button>}
          </div>
          {nq && matchedAddons.length > 0 && (
            <section className="cgroup">
              <h3 className="gdiv"><span>Produits trouvés</span></h3>
              <div className="grid">
                {matchedAddons.map(({ a, c }) => {
                  const cover = (a.photos || [])[0] || (a.croquis || [])[0] || (a.inspi || [])[0];
                  return (
                    <button key={a.id} className="card" onClick={() => { setColId(c.id); setAddonId(a.id); }}>
                      {cover
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="kthumb" src={cover} alt="" />
                        : <div className="kthumb ph">✎</div>}
                      <div className="kname">{a.nom}</div>
                      <div className="kmeta">{c.name}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {colGroups.length === 0 && matchedAddons.length === 0 && <div className="empty">Aucun résultat{q ? ` pour « ${q} »` : ""}.</div>}
          {colGroups.map(([label, items]) => (
            <section className="cgroup" key={label}>
              <h3 className="gdiv">
                <span>{label}</span>
                {mode === "mois" && (
                  <button className="btn ghost sm printmonth-btn" title="Imprimer les nouveautés de ce mois"
                    onClick={() => { setPrintMonth({ label, items }); setPrinting(true); }}>🖨️ Imprimer le mois</button>
                )}
              </h3>
              <div className="grid">
                {items.map((c) => {
                  const cover = c.cover || c.addons.flatMap((a) => a.photos || [])[0] || c.addons.flatMap((a) => a.croquis || [])[0];
                  return (
                    <button key={c.id} className="card" onClick={() => turnPage(() => setColId(c.id))}>
                      {cover
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="kthumb" src={cover} alt="" />
                        : <div className="kthumb ph">🌸</div>}
                      <div className="kname">{c.name}</div>
                      <div className="kmeta">{c.month || "—"} · {c.addons.length} pièce{c.addons.length > 1 ? "s" : ""}</div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {/* VUE ADDONS D'UNE COLLECTION */}
      {!loading && col && !addon && (
        <>
          <button className="btn ghost sm backbtn" onClick={() => turnPage(() => setColId(null))}>← Retour aux collections</button>
          {col.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="col-cover" src={col.cover} alt="" />
          )}
          <div className="col-head">
            {canEdit ? (
              <div className="col-headedit">
                <input className="col-nameinput" defaultValue={col.name} placeholder="Nom de la collection" onBlur={(e) => saveColField(col.id, { name: e.target.value })} />
                <input className="col-monthinput" defaultValue={col.month} placeholder="Mois (ex. Août 2026)" onBlur={(e) => saveColField(col.id, { month: e.target.value })} />
              </div>
            ) : (
              <h2>{col.name} <span style={{ color: "var(--muted)", fontSize: 15 }}>{col.month}</span></h2>
            )}
            {canEdit && (
              <label className="btn ghost sm covbtn">{col.cover ? "Changer l'image" : "Ajouter une image"}
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setColCover(col.id, f); }} />
              </label>
            )}
          </div>
          {canEdit ? (
            <div className="field colshop">
              <label>Lien de la collection Shopify</label>
              <input defaultValue={col.shopify} placeholder="https://…" onBlur={(e) => saveColShopify(col.id, e.target.value)} />
            </div>
          ) : col.shopify ? (
            <p><a className="shoplink" href={col.shopify} target="_blank" rel="noreferrer">Voir la collection sur Shopify ↗</a></p>
          ) : null}
          {canEdit && col.shopify && <p><a className="shoplink" href={col.shopify} target="_blank" rel="noreferrer">Ouvrir la collection Shopify ↗</a></p>}
          {col.shopify && <CollectionRevenue col={col} />}
          {col.addons.length > 0 && (
            <p><button className="btn ghost sm" onClick={() => setPrinting(true)}>🖨️ Exporter la collection en PDF ({col.addons.length} fiche{col.addons.length > 1 ? "s" : ""})</button></p>
          )}
          {canEdit && (
            <p><button className="btn ghost sm" style={{ color: "#b00", borderColor: "#e0b4b4" }} onClick={() => { if (window.confirm(`Supprimer la collection « ${col.name} » et ses ${col.addons.length} fiche(s) ? Cette action est irréversible.`)) deleteCollection(col.id); }}>🗑 Supprimer la collection</button></p>
          )}
          <div className="grid">
            {canEdit && <button className="card add-card" onClick={() => { setModal("addon"); setDraft(""); }}>+ Ajouter un addon</button>}
            {col.addons.map((a) => {
              const cover = (a.photos || [])[0] || (a.croquis || [])[0] || (a.inspi || [])[0];
              return (
                <button key={a.id} className="card" onClick={() => turnPage(() => setAddonId(a.id))}>
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="kthumb" src={cover} alt="" />
                    : <div className="kthumb ph">✎</div>}
                  <div className="kname">{a.nom}</div>
                  <div className="kmeta">{[fmtLabel(a.format), a.matiere, a.couleur].filter(Boolean).join(" · ") || "à détailler"}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* FICHE ADDON */}
      {!loading && col && addon && (
        <>
          <button className="btn ghost sm backbtn" onClick={() => turnPage(() => setAddonId(null))}>← Retour à « {col.name} »</button>
          <div className="crumb">
            <button onClick={() => turnPage(() => { setColId(null); setAddonId(null); })}>Collections</button> · <button onClick={() => turnPage(() => setAddonId(null))}>{col.name}</button> · {addon.nom}
          </div>
          <Fiche key={addon.id} addon={addon} onSave={saveAddon} onDelete={deleteAddon} canEdit={canEdit} />
        </>
      )}
      </>)}
      </div>
      </div>

      {/* EXPORT PDF — toutes les fiches de la collection */}
      {printing && col && !printMonth && (
        <div className="print-all">
          <h1 className="print-coltitle">{col.name} {col.month ? `· ${col.month}` : ""}</h1>
          {col.addons.map((a) => (
            <div className="print-fiche" key={a.id}><FicheRender addon={a} /></div>
          ))}
        </div>
      )}

      {/* EXPORT — nouveautés du mois, vue compacte (petits carrés, 2 par 2) */}
      {printing && printMonth && (
        <div className="print-all print-month">
          <h1 className="print-monthtitle">Nouveautés · {printMonth.label}</h1>
          <div className="print-monthgrid">
            {printMonth.items.map((c) => {
              const cover = c.cover || c.addons.flatMap((a) => a.photos || [])[0] || c.addons.flatMap((a) => a.croquis || [])[0];
              return (
                <div className="print-card" key={c.id}>
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img className="print-card-img" src={cover} alt="" />
                    : <div className="print-card-ph">✎</div>}
                  <div className="print-card-nom">{c.name}</div>
                  <div className="print-card-meta">{c.addons.length} pièce{c.addons.length > 1 ? "s" : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal === "col" ? "Nouvelle collection" : "Nouvel addon"}</h3>
            <input autoFocus placeholder={modal === "col" ? "Nom de la collection" : "Nom de l'addon"} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") (modal === "col" ? createCollection() : createAddon()); }} />
            {modal === "col" && <input placeholder="Mois (ex. Août 2026)" value={draft2} onChange={(e) => setDraft2(e.target.value)} />}
            <div className="row">
              <button className="btn ghost sm" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn sm" onClick={() => (modal === "col" ? createCollection() : createAddon())}>Créer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Fiche({ addon, onSave, onDelete, canEdit }: { addon: Addon; onSave: (id: string, patch: Partial<Addon>) => void; onDelete: (id: string) => void; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const flash = () => { setSaved("Enregistré ✓"); setTimeout(() => setSaved(""), 1500); };
  const save = (patch: Partial<Addon>) => { onSave(addon.id, patch); flash(); };
  const field = (k: keyof Addon, v: string) => save({ [k]: v } as Partial<Addon>);
  async function importTags() {
    if (!addon.shopify) return;
    const r = await fetch("/api/carnet/shopify-tags?url=" + encodeURIComponent(addon.shopify));
    const d = await r.json();
    if (d.tags?.length) save({ tags: Array.from(new Set([...(addon.tags || []), ...d.tags])) });
  }

  if (!editing) {
    return (
      <>
        <div className="fiche-toolbar">
          <button className="btn ghost sm" onClick={() => window.print()}>🖨️ Imprimer / PDF</button>
          {canEdit && <button className="btn sm" onClick={() => setEditing(true)}>✎ Modifier la fiche</button>}
        </div>
        <FicheRender addon={addon} />
      </>
    );
  }

  return (
    <div className="fiche">
      <div className="fiche-head">
        <input className="nom-input" defaultValue={addon.nom} onBlur={(e) => field("nom", e.target.value)} />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="save">{saved}</span><button className="btn ghost sm" onClick={() => setEditing(false)}>✓ Terminé</button></div>
      </div>

      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <button className="btn ghost sm" style={{ color: "#b00", borderColor: "#e0b4b4" }} onClick={() => { if (window.confirm(`Supprimer définitivement la fiche « ${addon.nom} » ? Cette action est irréversible.`)) onDelete(addon.id); }}>🗑 Supprimer cette fiche</button>
      </div>

      <FormatChips value={addon.format} onSave={(v) => save({ format: v })} />
      <div className="detrow">
        <TextField label="Matière" val={addon.matiere} list="mat" onSave={(v) => field("matiere", v)} placeholder="matière" />
        <TextField label="Couleur" val={addon.couleur} onSave={(v) => field("couleur", v)} />
        <TextField label="Finition" val={addon.finition} onSave={(v) => field("finition", v)} />
        <datalist id="mat">{MATIERES.map((f) => <option key={f} value={f} />)}</datalist>
      </div>

      <MultiChips label="Fournisseur" options={FOURNISSEURS} value={addon.fournisseur} onSave={(v) => save({ fournisseur: v })} allowFree />

      <div className="detrow">
        <TextField label="Date croquis" type="date" val={addon.date_croquis} onSave={(v) => field("date_croquis", v)} />
        <TextField label="Date dessin" type="date" val={addon.date_dessin} onSave={(v) => field("date_dessin", v)} />
        <TextField label="Date gravure" type="date" val={addon.date_gravure} onSave={(v) => field("date_gravure", v)} />
        <TextField label="Date de sortie" type="date" val={addon.date_sortie} onSave={(v) => field("date_sortie", v)} />
      </div>

      <MultiChips label="Mots-clés (pour la recherche)" options={[]} value={addon.tags} onSave={(v) => save({ tags: v })} allowFree freePlaceholder="ajouter un mot-clé…" />
      {addon.shopify && <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={importTags}>⬇ Importer les tags du produit Shopify</button>}

      <ImageZone title="Croquis" items={addon.croquis || []} onChange={(v) => save({ croquis: v })} />
      <ImageZone title="Inspiration / vectoriel" items={addon.inspi || []} onChange={(v) => save({ inspi: v })} />
      <FileZone title="Fichier .ai" items={addon.ai || []} onChange={(v) => save({ ai: v })} />
      <FileZone title="Fichier .gnh (gravure)" items={addon.gnh || []} onChange={(v) => save({ gnh: v })} />
      <ImageZone title="Photo du produit" items={addon.photos || []} onChange={(v) => save({ photos: v })} />
      <ImageZone title="Plan de sertissage" items={addon.sertissage || []} onChange={(v) => save({ sertissage: v })} />

      <div className="sec">
        <h3><span className="dot" /> Réglage (si laser)</h3>
        <div className="field"><textarea defaultValue={addon.laser} placeholder="ex. puissance · vitesse · passes · fréquence · dpi, matière, mode…" onBlur={(e) => field("laser", e.target.value)} /></div>
      </div>
      <div className="sec">
        <h3><span className="dot" /> Réalisation de l'addon</h3>
        <div className="field"><textarea defaultValue={addon.realisation} placeholder={"Comment tu l'as faite…\nex.\n1. graver sur polymère neutre\n2. coloration noir\n3. poncer\n4. coloration turquoise\n5. laser"} onBlur={(e) => field("realisation", e.target.value)} /></div>
      </div>
      <div className="detrow">
        <TextField label="Code MTRL / fournisseur" val={addon.mtrl} onSave={(v) => field("mtrl", v)} />
        <TextField label="Lien Shopify" val={addon.shopify} onSave={(v) => field("shopify", v)} placeholder="https://…" />
      </div>
      {addon.shopify && <p><a className="shoplink" href={addon.shopify} target="_blank" rel="noreferrer">Ouvrir la fiche Shopify ↗</a></p>}
    </div>
  );
}

function CollectionRevenue({ col }: { col: Collection }) {
  const [r, setR] = useState<{ total: number; units: number; since: string; orders?: number; byProduct?: { name: string; units: number; total: number }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  async function load(refresh?: boolean) {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/carnet/revenue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: col.shopify, colId: col.id, refresh, cacheOnly: !refresh }) });
      const d = await res.json();
      if (d.error) setErr(d.error);
      else if (d.none) setR(null);
      else setR(d);
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }
  useEffect(() => { setR(null); load(false); /* lit le cache à l'ouverture */ }, [col.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="colrev">
      {r ? (
        <div>
          <div className="colrev-val">
            💰 <b>≈ {r.total.toLocaleString("fr-CH")} CHF</b> · {r.units} pièce{r.units > 1 ? "s" : ""} vendue{r.units > 1 ? "s" : ""} <span className="colrev-since">depuis le {fdate(r.since)}</span>
            {r.byProduct && r.byProduct.length > 0 && <button className="btn ghost sm" style={{ marginLeft: 10 }} onClick={() => setOpen((o) => !o)}>{open ? "masquer le détail" : "voir le détail ↓"}</button>}
            <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => load(true)} disabled={loading}>{loading ? "…" : "↻ recalculer"}</button>
          </div>
          {open && r.byProduct && (
            <table className="colrev-detail">
              <tbody>
                {r.byProduct.map((p, i) => (
                  <tr key={i}><td>{p.name}</td><td>{p.units}×</td><td><b>{p.total.toLocaleString("fr-CH")} CHF</b></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : loading ? (
        <div className="colrev-val">💰 Calcul des ventes en cours… (ça peut prendre un moment)</div>
      ) : (
        <button className="btn ghost sm" onClick={() => load(true)}>💰 Combien elle a rapporté ?</button>
      )}
      {err && <div className="colrev-err" style={{ color: "#b00", fontSize: 13, marginTop: 4 }}>⚠️ {err}</div>}
    </div>
  );
}

function RGallery({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="r-sec">
      <h3>{title}</h3>
      <div className="r-gallery">
        {items.map((u, i) => (
          <a key={u + i} href={u} target="_blank" rel="noreferrer" className="r-shot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" loading="lazy" />
          </a>
        ))}
      </div>
    </section>
  );
}

function FicheRender({ addon }: { addon: Addon }) {
  const photos = addon.photos || [];
  const hero = photos[0] || (addon.croquis || [])[0] || (addon.inspi || [])[0];
  const tags = [...fmtArr(addon.format), addon.matiere, addon.couleur, addon.finition].filter(Boolean) as string[];
  return (
    <article className="render">
      <header className="r-hero">
        {hero
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="r-hero-img" src={hero} alt={addon.nom} />
          : <div className="r-hero-img ph">🌸</div>}
        <div className="r-hero-txt">
          <h1>{addon.nom}</h1>
          {tags.length > 0 && <div className="r-tags">{tags.map((t, i) => <span className="r-tag" key={i}>{t}</span>)}</div>}
        </div>
      </header>

      {(addon.date_croquis || addon.date_dessin || addon.date_gravure || addon.date_sortie) && (
        <section className="r-sec">
          <h3>Dates</h3>
          <div className="r-dates">
            {addon.date_croquis && <span><b>Croquis</b>{fdate(addon.date_croquis)}</span>}
            {addon.date_dessin && <span><b>Dessin</b>{fdate(addon.date_dessin)}</span>}
            {addon.date_gravure && <span><b>Gravure</b>{fdate(addon.date_gravure)}</span>}
            {addon.date_sortie && <span><b>Sortie</b>{fdate(addon.date_sortie)}</span>}
          </div>
        </section>
      )}

      {addon.sertissage && addon.sertissage.length > 0 && (
        <section className="r-sec">
          <h3>Plan de sertissage</h3>
          <div className="r-serti">
            {addon.sertissage.map((u, i) => (
              <a key={u + i} href={u} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="Plan de sertissage" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}

      <RGallery title="Photos du produit" items={photos.length > 1 ? photos.slice(1) : (hero && photos[0] === hero ? [] : photos)} />
      <RGallery title="Croquis" items={addon.croquis} />
      <RGallery title="Inspiration" items={addon.inspi} />

      {addon.ai && addon.ai.length > 0 && (
        <section className="r-sec">
          <h3>Fichier .ai</h3>
          <div className="zone">
            {addon.ai.map((f, i) => <button type="button" className="filechip" key={f.url + i} onClick={() => downloadFile(f.url, f.name)}>📄 {f.name || "fichier"} ⬇</button>)}
          </div>
        </section>
      )}
      {addon.gnh && addon.gnh.length > 0 && (
        <section className="r-sec">
          <h3>Fichier .gnh (gravure)</h3>
          <div className="zone">
            {addon.gnh.map((f, i) => <button type="button" className="filechip" key={f.url + i} onClick={() => downloadFile(f.url, f.name)}>📄 {f.name || "fichier"} ⬇</button>)}
          </div>
        </section>
      )}
      {addon.tags && addon.tags.length > 0 && (
        <section className="r-sec">
          <h3>Mots-clés</h3>
          <div className="chips">{addon.tags.map((t, i) => <span className="chip on" key={i}>{t}</span>)}</div>
        </section>
      )}
      {addon.laser?.trim() && (
        <section className="r-sec"><h3>Réglage laser</h3><pre className="r-text">{addon.laser}</pre></section>
      )}
      {addon.realisation?.trim() && (
        <section className="r-sec"><h3>Réalisation</h3><pre className="r-text">{addon.realisation}</pre></section>
      )}
      {(addon.mtrl || addon.shopify || (addon.fournisseur && addon.fournisseur.length > 0)) && (
        <footer className="r-foot">
          {addon.fournisseur && addon.fournisseur.length > 0 && <span>Fournisseur&nbsp;: <b>{addon.fournisseur.join(" · ")}</b></span>}
          {addon.mtrl && <span>Code MTRL&nbsp;: <b>{addon.mtrl}</b></span>}
          {addon.shopify && <a href={addon.shopify} target="_blank" rel="noreferrer">Fiche Shopify ↗</a>}
        </footer>
      )}
    </article>
  );
}

function MultiChips({ label, options, value, onSave, allowFree, freePlaceholder }: { label: string; options: string[]; value?: string[]; onSave: (v: string[]) => void; allowFree?: boolean; freePlaceholder?: string }) {
  const sel = Array.isArray(value) ? value : [];
  const opts = Array.from(new Set([...options, ...sel]));
  const [free, setFree] = useState("");
  const toggle = (f: string) => onSave(sel.includes(f) ? sel.filter((x) => x !== f) : [...sel, f]);
  const addFree = () => { const v = free.trim(); if (v && !sel.includes(v)) onSave([...sel, v]); setFree(""); };
  return (
    <div className="field" style={{ marginTop: 22 }}>
      <label>{label} <span style={{ textTransform: "none", letterSpacing: 0 }}>(plusieurs possibles)</span></label>
      <div className="chips">
        {opts.map((f) => <button key={f} type="button" className={"chip" + (sel.includes(f) ? " on" : "")} onClick={() => toggle(f)}>{f}</button>)}
      </div>
      {allowFree && (
        <div className="freeadd">
          <input value={free} onChange={(e) => setFree(e.target.value)} placeholder={freePlaceholder || "autre…"} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } }} />
          <button className="btn ghost sm" type="button" onClick={addFree}>Ajouter</button>
        </div>
      )}
    </div>
  );
}

function FormatChips({ value, onSave }: { value?: string | string[]; onSave: (v: string[]) => void }) {
  const sel = fmtArr(value);
  const opts = Array.from(new Set([...FORMATS, ...sel]));
  const toggle = (f: string) => onSave(sel.includes(f) ? sel.filter((x) => x !== f) : [...sel, f]);
  return (
    <div className="field" style={{ marginTop: 22 }}>
      <label>Format <span style={{ textTransform: "none", letterSpacing: 0 }}>(plusieurs possibles)</span></label>
      <div className="chips">
        {opts.map((f) => (
          <button key={f} type="button" className={"chip" + (sel.includes(f) ? " on" : "")} onClick={() => toggle(f)}>{f}</button>
        ))}
      </div>
    </div>
  );
}

function TextField({ label, val, onSave, list, placeholder, type }: { label: string; val?: string; onSave: (v: string) => void; list?: string; placeholder?: string; type?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type={type || "text"} defaultValue={val} list={list} placeholder={placeholder} onBlur={(e) => onSave(e.target.value)} />
    </div>
  );
}

async function downloadFile(url: string, name: string) {
  try {
    const r = await fetch(url);
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = u; a.download = name || "fichier.ai";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

async function uploadFile(file: File): Promise<{ url: string; name: string; image: boolean } | null> {
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/carnet/upload", { method: "POST", body: fd });
  const d = await r.json();
  return d.url ? { url: d.url, name: d.name, image: d.image } : null;
}

function ImageZone({ title, items, onChange }: { title: string; items: string[]; onChange: (v: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const urls: string[] = [];
    for (const f of Array.from(files)) { const u = await uploadFile(f); if (u) urls.push(u.url); }
    onChange([...items, ...urls]);
    setBusy(false);
  }
  return (
    <div className="sec">
      <h3><span className="dot" /> {title}</h3>
      <div className="zone">
        {items.map((u, i) => (
          <div className="thumb" key={u + i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" />
            <button className="rm" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className={"drop" + (busy ? " busy" : "")} onClick={() => inp.current?.click()}>
          {busy ? "Envoi…" : <>＋<span>ajouter</span></>}
        </div>
        <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
    </div>
  );
}

function FileZone({ title, items, onChange }: { title: string; items: FileRef[]; onChange: (v: FileRef[]) => void }) {
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const added: FileRef[] = [];
    for (const f of Array.from(files)) { const u = await uploadFile(f); if (u) added.push({ url: u.url, name: u.name }); }
    onChange([...items, ...added]);
    setBusy(false);
  }
  return (
    <div className="sec">
      <h3><span className="dot" /> {title}</h3>
      <div className="zone">
        {items.map((f, i) => (
          <span className="filechip" key={f.url + i}>
            <button type="button" className="dlname" onClick={() => downloadFile(f.url, f.name)}>📄 {f.name || "fichier"} ⬇</button>
            <button className="rm" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
        <div className={"drop" + (busy ? " busy" : "")} onClick={() => inp.current?.click()}>
          {busy ? "Envoi…" : <>＋<span>ajouter</span></>}
        </div>
        <input ref={inp} type="file" hidden onChange={(e) => add(e.target.files)} />
      </div>
    </div>
  );
}

// ─────────────── Onglet « Projet Icelea — Amila » ───────────────
const ICELEA_CODE = "M00d2025";
type IceProjet = { id: string; nom: string; image: string; statut: string; date_creation: string; date_premier_mail: string; date_sortie: string; mails: string; corrections: string[]; photo: string; mtrl: string };
const ICE_STATUTS: { v: string; label: string; cls: string }[] = [
  { v: "", label: "⚪️ Pas reçu", cls: "st-rien" },
  { v: "recu", label: "🟢 Proto reçu · OK", cls: "st-recu" },
  { v: "correction", label: "🟠 Correction en cours", cls: "st-corr" },
  { v: "annule", label: "🩷 Annulé", cls: "st-annule" },
  { v: "sorti", label: "🩵 Sorti", cls: "st-sorti" },
];
const iceCls = (v: string) => (ICE_STATUTS.find((s) => s.v === v) || ICE_STATUTS[0]).cls;
// Ancienneté depuis la date de création : orange après 2 mois, rose après 4 mois.
const iceAgeCls = (d: string): string => {
  if (!d) return "";
  const t = new Date(d + "T00:00:00Z").getTime();
  if (isNaN(t)) return "";
  const months = (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44);
  if (months >= 4) return "age-rose";
  if (months >= 2) return "age-orange";
  return "";
};

async function iceApi(action: string, extra: Record<string, unknown> = {}) {
  const r = await fetch("/api/carnet/icelea", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: ICELEA_CODE, action, ...extra }) });
  return r.json();
}
async function iceUpload(file: File): Promise<string | null> {
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch("/api/carnet/icelea-upload?code=" + encodeURIComponent(ICELEA_CODE), { method: "POST", body: fd });
  const d = await r.json();
  return d.url || null;
}

function IceleaBoard() {
  const [unlocked, setUnlocked] = useState<boolean>(() => typeof window !== "undefined" && window.localStorage.getItem("icelea_ok") === ICELEA_CODE);
  const [code, setCode] = useState("");
  const [projets, setProjets] = useState<IceProjet[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/carnet/icelea?code=" + encodeURIComponent(ICELEA_CODE))
      .then((r) => r.json()).then((d) => { setProjets(d.projets || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { if (unlocked) load(); }, [unlocked, load]);

  function tryCode() {
    if (code.trim() === ICELEA_CODE) { window.localStorage.setItem("icelea_ok", ICELEA_CODE); setUnlocked(true); }
    else alert("Code incorrect.");
  }
  async function patch(id: string, p: Partial<IceProjet>) {
    setProjets((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
    await iceApi("update", { id, patch: p });
  }
  async function createProjet(nom: string) {
    const n = nom.trim() || "Nouveau projet";
    const d = await iceApi("create", { nom: n });
    if (d.projet) { setProjets((prev) => [d.projet as IceProjet, ...prev]); setAdding(false); setOpenId(d.projet.id); }
  }
  async function removeProjet(id: string) {
    setProjets((prev) => prev.filter((x) => x.id !== id));
    setOpenId(null);
    await iceApi("delete", { id });
  }
  // Quand le produit est sorti → créer une vraie fiche dans le Carnet (collection « Sorties Icelea »).
  async function duplicateToCarnet(p: IceProjet) {
    try {
      const r = await fetch("/api/carnet");
      const d = await r.json();
      if (!r.ok || d.error) throw new Error("auth");
      const cols: { id: string; name: string }[] = d.collections || [];
      let target = cols.find((c) => norm(c.name) === norm("Sorties Icelea"));
      if (!target) {
        const cc = await api("createCollection", { name: "Sorties Icelea", month: "" });
        target = cc.collection;
      }
      if (!target) throw new Error("col");
      const ca = await api("createAddon", { collectionId: target.id, nom: p.nom });
      if (!ca?.addon?.id) throw new Error("addon");
      // On emmène TOUTES les photos du proto : image de départ + corrections + photo reçue (sans doublon).
      const photos = Array.from(new Set([p.image, ...(p.corrections || []), p.photo].filter(Boolean)));
      await api("updateAddon", { id: ca.addon.id, patch: { photos, mtrl: p.mtrl, date_sortie: p.date_sortie } });
      alert("✅ « " + p.nom + " » a été dupliqué dans le Carnet → collection « Sorties Icelea ».");
    } catch {
      alert("Pour dupliquer dans le Carnet, il faut être connectée avec ton compte Mood (Amila) — le Carnet lui-même est protégé. Ouvre-le connectée, puis réessaie.");
    }
  }

  if (!unlocked) {
    return (
      <div className="ice-lock">
        <div className="ice-lock-card">
          <div className="ice-lock-emoji">🔒</div>
          <h2>Projet Icelea</h2>
          <p>Espace réservé. Entre le code d’accès.</p>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" onKeyDown={(e) => { if (e.key === "Enter") tryCode(); }} autoFocus />
          <button className="btn" onClick={tryCode}>Entrer</button>
        </div>
      </div>
    );
  }

  const open = projets.find((p) => p.id === openId) || null;

  return (
    <div className="ice">
      <div className="ice-head">
        <h2>📦 Projets demandés à Icelea</h2>
        <button className="btn sm" onClick={() => setAdding(true)}>+ Nouveau projet</button>
      </div>
      <div className="ice-legend">
        {ICE_STATUTS.map((s) => <span key={s.v} className={"ice-lg " + s.cls}>{s.label}</span>)}
      </div>

      {loading ? <div className="empty">Chargement…</div> : (
        <div className="ice-list">
          {projets.length === 0 && <div className="empty">Aucun projet pour l’instant. Clique « + Nouveau projet ».</div>}
          {projets.map((p) => (
            <div className="ice-row" key={p.id} onClick={() => setOpenId(p.id)}>
              {p.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="ice-thumb" src={p.image} alt="" />
                : <div className="ice-thumb ph">📦</div>}
              <div className="ice-rowmain">
                <span className={"ice-name " + iceCls(p.statut)}>{p.nom}</span>
                {p.date_creation && <span className={"ice-created " + iceAgeCls(p.date_creation)}>💡 Créé le {fdate(p.date_creation)}</span>}
              </div>
              <select className="ice-statut" value={p.statut} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(p.id, { statut: e.target.value })}>
                {ICE_STATUTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {adding && <IceAddModal onClose={() => setAdding(false)} onCreate={createProjet} />}

      {open && (
        <div className="modal-bg" onClick={() => setOpenId(null)}>
          <div className="modal ice-detail" onClick={(e) => e.stopPropagation()}>
            <div className="ice-detail-head">
              <input className="ice-nom-input" defaultValue={open.nom} onBlur={(e) => patch(open.id, { nom: e.target.value })} />
              <button className="btn ghost sm" onClick={() => setOpenId(null)}>✓ Fermer</button>
            </div>

            <div className="ice-detail-img">
              {open.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={open.image} alt="" />
                : <div className="ice-detail-ph">📦</div>}
              <label className="btn ghost sm">{open.image ? "Changer l'image" : "Ajouter l'image du proto"}
                <input type="file" accept="image/*" hidden disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); const u = await iceUpload(f); if (u) await patch(open.id, { image: u }); setBusy(false); }} />
              </label>
            </div>

            <div className="ice-field">
              <label>Date de création (idée / 1er mail à Icelea)</label>
              <input type="date" defaultValue={open.date_creation} onBlur={(e) => patch(open.id, { date_creation: e.target.value })} />
            </div>

            <div className="ice-field">
              <label>État</label>
              <select value={open.statut} onChange={(e) => patch(open.id, { statut: e.target.value })}>
                {ICE_STATUTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>

            {open.statut === "sorti" && (
              <div className="ice-field">
                <button className="btn sm ice-dup" onClick={() => duplicateToCarnet(open)}>📓 Dupliquer dans le Carnet</button>
                <span className="ice-dup-hint">Crée la fiche dans « Le Carnet » → collection « Sorties Icelea ».</span>
              </div>
            )}

            <div className="ice-field">
              <label>Date de sortie</label>
              <input type="date" defaultValue={open.date_sortie} onBlur={(e) => patch(open.id, { date_sortie: e.target.value })} />
            </div>

            <div className="ice-field">
              <label>Date du premier mail</label>
              <input type="date" defaultValue={open.date_premier_mail} onBlur={(e) => patch(open.id, { date_premier_mail: e.target.value })} />
            </div>

            <div className="ice-field">
              <label>Échanges de mails (colle ou transfère ici)</label>
              <textarea defaultValue={open.mails} rows={6} placeholder="Colle ici les mails échangés avec Icelea…" onBlur={(e) => patch(open.id, { mails: e.target.value })} />
            </div>

            <IceCorrZone items={open.corrections || []} onChange={(v) => patch(open.id, { corrections: v })} />

            <div className="ice-field">
              <label>Photo du produit reçu (dans son sachet)</label>
              <div className="ice-photo-zone">
                {open.photo
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="ice-photo" src={open.photo} alt="" />
                  : <div className="ice-photo ph">📷</div>}
                <label className="btn ghost sm">{open.photo ? "Changer la photo" : "Ajouter la photo"}
                  <input type="file" accept="image/*" hidden disabled={busy} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); const u = await iceUpload(f); if (u) await patch(open.id, { photo: u }); setBusy(false); }} />
                </label>
              </div>
            </div>

            <div className="ice-field">
              <label>Code MTRL</label>
              <input defaultValue={open.mtrl} placeholder="ex. MTRL-MD-RI-274-…" onBlur={(e) => patch(open.id, { mtrl: e.target.value })} />
            </div>

            <div className="ice-detail-foot">
              <button className="btn ghost sm" style={{ color: "#b00", borderColor: "#e0b4b4" }} onClick={() => { if (window.confirm(`Supprimer le projet « ${open.nom} » ?`)) removeProjet(open.id); }}>🗑 Supprimer</button>
              {busy && <span className="ice-busy">Envoi de l’image…</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IceCorrZone({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const urls: string[] = [];
    for (const f of Array.from(files)) { const u = await iceUpload(f); if (u) urls.push(u); }
    onChange([...items, ...urls]);
    setBusy(false);
  }
  return (
    <div className="ice-field">
      <label>Corrections (une image par correction)</label>
      <div className="ice-corr">
        {items.map((u, i) => (
          <div className="ice-corr-item" key={u + i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" />
            <span className="ice-corr-lbl">Correction {i + 1}</span>
            <button className="rm" onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <div className={"ice-corr-add" + (busy ? " busy" : "")} onClick={() => inp.current?.click()}>{busy ? "Envoi…" : "＋ ajouter une correction"}</div>
        <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
    </div>
  );
}

// Fenêtre « nouveau projet » isolée : son propre champ texte → taper le nom ne redessine plus la liste (fluide).
function IceAddModal({ onClose, onCreate }: { onClose: () => void; onCreate: (nom: string) => void }) {
  const [nom, setNom] = useState("");
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nouveau projet Icelea</h3>
        <input autoFocus placeholder="Nom du projet (ex. Pavone deux tiers)" value={nom} onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onCreate(nom); }} />
        <div className="row">
          <button className="btn ghost sm" onClick={onClose}>Annuler</button>
          <button className="btn sm" onClick={() => onCreate(nom)}>Créer</button>
        </div>
      </div>
    </div>
  );
}
