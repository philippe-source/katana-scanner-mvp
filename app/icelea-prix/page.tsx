"use client";

import { useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceItem { ref: string; size_range: string; price: number; count: number }

interface CompareRow {
  ref: string; size_range: string;
  variant_id: number; variant_sku: string; variant_size: number | null;
  material_id: number; material_name: string;
  current_price: number; invoice_price: number;
  delta: number | null; needs_update: boolean;
}

interface CompareResult {
  rows: CompareRow[]; toUpdate: number; unchanged: number;
  notFound: string[]; totalMaterials: number;
}

type Step = "upload" | "compare" | "apply" | "csv";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deltaClass(delta: number | null): string {
  if (delta === null) return "text-zinc-500";
  if (delta > 0.05) return "text-red-400 font-semibold";
  if (delta < -0.05) return "text-green-400 font-semibold";
  if (Math.abs(delta) > 0) return "text-yellow-400";
  return "text-zinc-500";
}

function fmtDelta(delta: number | null): string {
  if (delta === null) return "—";
  const s = delta >= 0 ? "+" : "";
  return `${s}${(delta * 100).toFixed(1)}%`;
}

function fmtPrice(p: number): string {
  return `$${p.toFixed(2)}`;
}

// Group comparison rows by ref + size_range for display
function groupRows(rows: CompareRow[]) {
  const groups: Record<string, { ref: string; size_range: string; rows: CompareRow[] }> = {};
  for (const r of rows) {
    const key = `${r.ref}/${r.size_range}`;
    if (!groups[key]) groups[key] = { ref: r.ref, size_range: r.size_range, rows: [] };
    groups[key].rows.push(r);
  }
  return Object.values(groups).sort((a, b) => a.ref.localeCompare(b.ref) || a.size_range.localeCompare(b.size_range));
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-semibold ${active ? "text-zinc-100" : done ? "text-zinc-400" : "text-zinc-600"}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? "bg-blue-600" : done ? "bg-zinc-700 text-zinc-400" : "bg-zinc-800 text-zinc-600"}`}>
        {done ? "✓" : n}
      </span>
      {label}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IceleaPrixPage() {
  const [step, setStep] = useState<Step>("upload");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [pdfName, setPdfName] = useState("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [applyResult, setApplyResult] = useState<{ updated: number; errors: number; errorDetails: string[] } | null>(null);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => setLog(l => [...l, msg]);

  // STEP 1 — Parse PDF
  async function handleParse() {
    if (!pdfFile) return;
    setLoading(true); setError(null); setLog([]);
    try {
      addLog(`Lecture de ${pdfFile.name}…`);
      const fd = new FormData();
      fd.append("pdf", pdfFile);
      const res = await fetch("/api/icelea-prix/parse", { method: "POST", body: fd });
      const data = await res.json() as { items?: InvoiceItem[]; error?: string; rawText?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Erreur de lecture PDF");
        if (data.rawText) addLog("Texte extrait (debug) :\n" + data.rawText);
        return;
      }
      setInvoiceItems(data.items!);
      addLog(`${data.items!.length} groupes ref×taille extraits de la facture.`);
      setStep("compare");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  // STEP 2 — Compare with Katana
  async function handleCompare() {
    setLoading(true); setError(null); setLog([]);
    try {
      addLog(`Chargement des matériaux Katana Icelea (peut prendre 30–60 secondes)…`);
      const res = await fetch("/api/icelea-prix/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: invoiceItems }),
      });
      const data = await res.json() as CompareResult & { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Erreur"); return; }
      setCompareResult(data);
      addLog(`${data.totalMaterials} matériaux Icelea chargés depuis Katana.`);
      addLog(`${data.toUpdate} variants à mettre à jour, ${data.unchanged} sans changement.`);
      if (data.notFound.length) addLog(`${data.notFound.length} refs sans matériau Katana : ${data.notFound.slice(0, 5).join(", ")}${data.notFound.length > 5 ? "…" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  // STEP 3 — Apply to Katana.
  // Katana freine les écritures : une tranche de 150 tenait le navigateur ~3 min en
  // attente sans aucun signe de vie, et il finissait par lâcher ("Failed to fetch")
  // alors que l'écriture, elle, avait abouti. Tranches courtes + reprise sur coupure.
  async function handleApply() {
    if (!compareResult) return;
    setLoading(true); setError(null); setLog([]);
    const CHUNK = 25;
    const toUpdate = compareResult.rows.filter(r => r.needs_update);
    const chunks: typeof toUpdate[] = [];
    for (let i = 0; i < toUpdate.length; i += CHUNK) chunks.push(toUpdate.slice(i, i + CHUNK));

    let totalUpdated = 0, totalErrors = 0;
    const allErrorDetails: string[] = [];
    setApplyProgress({ done: 0, total: toUpdate.length });

    // Réécrire un prix déjà écrit repose la même valeur : une tranche est rejouable.
    async function sendChunk(rows: typeof toUpdate, label: string) {
      let lastErr = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch("/api/icelea-prix/apply-katana", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) {
            const txt = await res.text();
            lastErr = `HTTP ${res.status} — ${txt.slice(0, 200)}`;
          } else {
            const data = await res.json() as { updated: number; errors: number; errorDetails: string[]; error?: string };
            if (data.error) { lastErr = data.error; }
            else return data;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "connexion interrompue";
        }
        if (attempt < 3) {
          addLog(`  ${label} : ${lastErr} — nouvelle tentative (${attempt + 1}/3)…`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      throw new Error(`${label} : ${lastErr}`);
    }

    try {
      addLog(`Mise à jour de ${toUpdate.length} variants Katana en ${chunks.length} tranche(s)…`);
      for (let ci = 0; ci < chunks.length; ci++) {
        const data = await sendChunk(chunks[ci], `tranche ${ci + 1}/${chunks.length}`);
        totalUpdated += data.updated;
        totalErrors += data.errors;
        allErrorDetails.push(...data.errorDetails);
        setApplyProgress({ done: Math.min((ci + 1) * CHUNK, toUpdate.length), total: toUpdate.length });
      }
      setApplyResult({ updated: totalUpdated, errors: totalErrors, errorDetails: allErrorDetails });
      addLog(`✓ ${totalUpdated} variants mis à jour dans Katana.`);
      if (totalErrors) addLog(`⚠ ${totalErrors} erreurs.`);
      setStep("csv");
    } catch (e) {
      const cause = e instanceof Error ? e.message : "Erreur réseau";
      setError(
        `${cause} — ${totalUpdated} prix sur ${toUpdate.length} déjà écrits dans Katana. ` +
        `Relancer est sans risque : réécrire un prix déjà à jour ne change rien.`
      );
      addLog(`⚠ Arrêt après ${totalUpdated} prix écrits sur ${toUpdate.length}.`);
    } finally {
      setLoading(false);
      setApplyProgress(null);
    }
  }

  // STEP 4 — Download Shopify CSV (2 phases pour éviter le timeout Vercel)
  async function handleDownloadCSV() {
    if (!compareResult) return;
    setLoading(true); setError(null);

    // Variants Icelea avec hausse >5%
    const impactedVariantIds = compareResult.rows
      .filter(r => r.delta !== null && r.delta > 0.05)
      .map(r => r.variant_id);

    if (!impactedVariantIds.length) {
      addLog("Aucun article avec hausse >5% — pas de CSV à générer.");
      setLoading(false);
      return;
    }

    try {
      // Phase 1 : scan des recettes Katana par tranches de 15 pages
      addLog(`Phase 1 — Scan recettes Katana (${impactedVariantIds.length} variants impactés)…`);
      const PAGE_CHUNK = 15;
      const allImpacted = new Map<number, Set<string>>();
      let pageStart = 1;
      let hasMore = true;

      while (hasMore) {
        const res = await fetch("/api/icelea-prix/scan-recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantIds: impactedVariantIds, pageStart, pageCount: PAGE_CHUNK }),
        });
        if (!res.ok) {
          const txt = await res.text();
          setError(`Erreur scan recettes (pages ${pageStart}-${pageStart + PAGE_CHUNK - 1}) : ${txt.slice(0, 200)}`);
          return;
        }
        const data = await res.json() as { impacted: { pvId: number; refs: string[] }[]; hasMore: boolean; error?: string };
        if (data.error) { setError(data.error); return; }
        for (const { pvId, refs } of data.impacted) {
          if (!allImpacted.has(pvId)) allImpacted.set(pvId, new Set());
          refs.forEach(r => allImpacted.get(pvId)!.add(r));
        }
        hasMore = data.hasMore;
        pageStart += PAGE_CHUNK;
        addLog(`  Pages ${pageStart - PAGE_CHUNK}-${pageStart - 1} scannées — ${allImpacted.size} produits impactés jusqu'ici`);
      }

      addLog(`Phase 2 — Résolution SKU + chargement Shopify (${allImpacted.size} produits)…`);

      if (!allImpacted.size) {
        addLog("Aucun produit Katana trouvé dans les recettes.");
        return;
      }

      // Phase 2 : générer le CSV depuis les IDs consolidés
      const date = new Date().toISOString().slice(0, 10);
      const impactedArr = [...allImpacted.entries()].map(([pvId, refs]) => ({ pvId, refs: [...refs] }));
      const res2 = await fetch("/api/icelea-prix/gen-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impacted: impactedArr, filename: `icelea-shopify-impact-${date}.csv` }),
      });

      if (res2.headers.get("content-type")?.includes("text/csv")) {
        const blob = await res2.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `icelea-shopify-impact-${date}.csv`; a.click();
        URL.revokeObjectURL(url);
        addLog("✓ CSV téléchargé.");
      } else {
        if (!res2.ok) {
          const txt = await res2.text();
          setError(`Erreur génération CSV : ${txt.slice(0, 200)}`);
          return;
        }
        const data2 = await res2.json() as { message?: string; error?: string };
        if (data2.message) addLog(data2.message);
        if (data2.error) setError(data2.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const groups = compareResult ? groupRows(compareResult.rows) : [];
  const hasHighImpact = compareResult?.rows.some(r => r.delta !== null && r.delta > 0.05) ?? false;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-10">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Outils</a>
          <h1 className="text-2xl font-semibold text-zinc-50 mt-2">Prix Icelea</h1>
          <p className="text-sm text-zinc-400 mt-1">Upload la facture PDF → comparaison Katana → patch prix achat → CSV impact Shopify</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4 flex-wrap">
          <StepBadge n={1} label="Upload PDF" active={step === "upload"} done={step !== "upload"} />
          <span className="text-zinc-700 text-xs">›</span>
          <StepBadge n={2} label="Comparer Katana" active={step === "compare"} done={step === "apply" || step === "csv"} />
          <span className="text-zinc-700 text-xs">›</span>
          <StepBadge n={3} label="Appliquer Katana" active={step === "apply"} done={step === "csv"} />
          <span className="text-zinc-700 text-xs">›</span>
          <StepBadge n={4} label="CSV Shopify" active={step === "csv"} done={false} />
        </div>

        {/* STEP 1 — Upload */}
        {step === "upload" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <h2 className="text-xs font-bold tracking-widest uppercase text-zinc-500">Facture Icelea (PDF)</h2>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-zinc-700 rounded-xl p-10 text-center cursor-pointer hover:border-zinc-500 transition-colors"
            >
              {pdfFile ? (
                <p className="text-zinc-200 font-semibold">{pdfFile.name}</p>
              ) : (
                <p className="text-zinc-500 text-sm">Cliquez pour sélectionner la facture PDF Icelea<br /><span className="text-xs text-zinc-600">(INV0005-05-2026.pdf, etc.)</span></p>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setPdfFile(f); setPdfName(f.name); } }} />
            <button
              onClick={handleParse}
              disabled={!pdfFile || loading}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors"
            >
              {loading ? "Lecture en cours…" : "Lire la facture"}
            </button>
          </div>
        )}

        {/* STEP 2 — Compare */}
        {step === "compare" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
              <h2 className="text-xs font-bold tracking-widest uppercase text-zinc-500">Facture parsée — {pdfName}</h2>
              <p className="text-sm text-zinc-300">{invoiceItems.length} groupes ref×taille extraits. Cliquez pour charger les prix actuels depuis Katana et comparer.</p>
              <div className="flex gap-3">
                <button onClick={handleCompare} disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                  {loading ? "Chargement Katana…" : "Comparer avec Katana"}
                </button>
                <button onClick={() => setStep("upload")}
                  className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
                  Changer de PDF
                </button>
              </div>
            </div>

            {/* Résultats comparaison */}
            {compareResult && (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-wrap gap-6">
                  <div><p className="text-xs text-zinc-500">À mettre à jour</p><p className="text-2xl font-bold text-zinc-100">{compareResult.toUpdate}</p></div>
                  <div><p className="text-xs text-zinc-500">Sans changement</p><p className="text-2xl font-bold text-zinc-400">{compareResult.unchanged}</p></div>
                  {compareResult.notFound.length > 0 && (
                    <div><p className="text-xs text-zinc-500">Sans matériau Katana</p><p className="text-2xl font-bold text-orange-400">{compareResult.notFound.length}</p></div>
                  )}
                  {hasHighImpact && (
                    <div><p className="text-xs text-zinc-500">Hausse &gt;5% (impact BOM)</p>
                      <p className="text-2xl font-bold text-red-400">{compareResult.rows.filter(r => r.delta !== null && r.delta > 0.05).length}</p></div>
                  )}
                </div>

                {/* Tableau */}
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900">
                          <th className="px-3 py-2.5 text-left text-zinc-500 font-semibold">Réf</th>
                          <th className="px-3 py-2.5 text-left text-zinc-500 font-semibold">Taille</th>
                          <th className="px-3 py-2.5 text-right text-zinc-500 font-semibold">Variants</th>
                          <th className="px-3 py-2.5 text-right text-zinc-500 font-semibold">Prix actuel Katana</th>
                          <th className="px-3 py-2.5 text-right text-zinc-500 font-semibold">Prix facture</th>
                          <th className="px-3 py-2.5 text-right text-zinc-500 font-semibold">Delta</th>
                          <th className="px-3 py-2.5 text-left text-zinc-500 font-semibold">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g, i) => {
                          const sample = g.rows[0];
                          const toUpd = g.rows.filter(r => r.needs_update).length;
                          const curPrices = [...new Set(g.rows.map(r => r.current_price.toFixed(2)))];
                          const curStr = curPrices.length <= 2 ? curPrices.map(p => `$${p}`).join("/") : `$${curPrices[0]}…`;
                          return (
                            <tr key={i} className={`border-b border-zinc-800/60 ${i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/40"}`}>
                              <td className="px-3 py-2 font-mono text-zinc-300">{g.ref}</td>
                              <td className="px-3 py-2 text-zinc-400">{g.size_range === "none" ? "—" : g.size_range}</td>
                              <td className="px-3 py-2 text-right text-zinc-400">{g.rows.length}</td>
                              <td className="px-3 py-2 text-right text-zinc-400 font-mono">{curStr}</td>
                              <td className="px-3 py-2 text-right text-zinc-200 font-mono font-semibold">{fmtPrice(sample.invoice_price)}</td>
                              <td className={`px-3 py-2 text-right font-mono ${deltaClass(sample.delta)}`}>{fmtDelta(sample.delta)}</td>
                              <td className="px-3 py-2">
                                {toUpd > 0
                                  ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-700 bg-blue-900/40 text-blue-300">{toUpd} à updater</span>
                                  : <span className="text-[10px] text-zinc-600">inchangé</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <button onClick={() => setStep("apply")} disabled={compareResult.toUpdate === 0}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                  Appliquer {compareResult.toUpdate} mises à jour dans Katana →
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 — Apply */}
        {step === "apply" && compareResult && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <h2 className="text-xs font-bold tracking-widest uppercase text-zinc-500">Confirmation Katana</h2>
            <p className="text-sm text-zinc-300">
              {compareResult.toUpdate} variants vont être mis à jour dans Katana avec les prix de la facture.
              {hasHighImpact && <span className="text-red-400 ml-1">⚠ {compareResult.rows.filter(r => r.delta !== null && r.delta > 0.05).length} articles ont une hausse &gt;5% — un CSV Shopify sera générable à l&apos;étape suivante.</span>}
            </p>
            <div className="flex gap-3">
              <button onClick={handleApply} disabled={loading}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                {loading ? (applyProgress ? `${applyProgress.done} / ${applyProgress.total} variants…` : "Démarrage…") : `Confirmer — ${compareResult.toUpdate} variants`}
              </button>
              <button onClick={() => setStep("compare")} disabled={loading}
                className="px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
                ← Retour
              </button>
            </div>
            {applyProgress && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Progression</span>
                  <span>{applyProgress.done} / {applyProgress.total}</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((applyProgress.done / applyProgress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 4 — CSV */}
        {step === "csv" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
            <h2 className="text-xs font-bold tracking-widest uppercase text-zinc-500">Katana mis à jour ✓</h2>
            {applyResult && (
              <p className="text-sm text-zinc-300">
                <span className="text-green-400 font-semibold">{applyResult.updated} variants</span> mis à jour.
                {applyResult.errors > 0 && <span className="text-red-400 ml-2">⚠ {applyResult.errors} erreurs.</span>}
              </p>
            )}
            {hasHighImpact ? (
              <>
                <p className="text-sm text-zinc-400">Des articles ont une hausse &gt;5%. Télécharge le CSV des produits Shopify impactés pour ajuster leurs prix de vente.</p>
                <button onClick={handleDownloadCSV} disabled={loading}
                  className="px-5 py-2.5 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-sm transition-colors">
                  {loading ? "Analyse BOM en cours…" : "↓ Télécharger CSV impact Shopify"}
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Aucun article avec hausse &gt;5% — pas de CSV Shopify nécessaire.</p>
            )}
            <button onClick={() => { setStep("upload"); setPdfFile(null); setInvoiceItems([]); setCompareResult(null); setApplyResult(null); setLog([]); setError(null); }}
              className="px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition-colors">
              Nouvelle facture
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-800 bg-red-900/30 p-4 text-sm text-red-300 whitespace-pre-wrap">{error}</div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-1">
            {log.map((l, i) => <p key={i} className="text-xs font-mono text-zinc-400">{l}</p>)}
          </div>
        )}

      </div>
    </div>
  );
}
