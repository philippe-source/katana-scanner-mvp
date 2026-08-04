import { NextResponse } from "next/server";
import { incrementGeminiImageCount } from "@/lib/gemini-counter";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3-pro-image-preview";

export const maxDuration = 60;

function parseDataUrl(s: string) {
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

export async function POST(req: Request) {
  if (!GEMINI_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY manquante côté serveur" }, { status: 500 });
  }

  let body: { addon?: string; couleurRef?: string; note?: string | null; emailSurfaceOnly?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const { addon, couleurRef, note, emailSurfaceOnly } = body;
  const surfaceRule = emailSurfaceOnly
    ? `- APPLIQUE la couleur et la finition de l'Image 2 UNIQUEMENT sur la SURFACE ÉMAILLÉE EXTÉRIEURE de l'addon (la bande décorative visible sur le dessus et les côtés). NE recolore SURTOUT PAS l'intérieur de l'anneau, ni les bords/rails métalliques nus : l'intérieur de la bague et tout métal apparent (argent 925 / acier poli) restent EXACTEMENT dans leur couleur et finition d'origine, totalement inchangés.`
    : `- APPLIQUE la couleur et la finition de matière de l'Image 2 sur toute la surface métallique de l'addon (extérieur ET intérieur visible).`;
  if (!addon || !couleurRef) {
    return NextResponse.json({ error: "Il faut une image d'addon ET une image de référence couleur." }, { status: 400 });
  }
  const a = parseDataUrl(addon);
  const c = parseDataUrl(couleurRef);
  if (!a || !c) return NextResponse.json({ error: "Format image invalide (data URL attendue)" }, { status: 400 });

  const prompt = `🎨 CHANGEMENT DE COULEUR — Mood Collection addon.

═══════════════════════════════════════════
CONTEXTE
═══════════════════════════════════════════

Mood Collection fabrique des bagues à système modulaire. Les "addons" (anneaux décorés) existent dans différentes matières et couleurs : aluminium anodisé (rose, bleu, vert menthe, lavande, etc.), acier 316L (poli miroir / brossé / sablé), argent 925, or 9K/18K, céramique, tantale.

- IMAGE 1 = l'ADDON ORIGINAL à recolorier (anneau Mood, garder forme, gravure, finition).
- IMAGE 2 = LA RÉFÉRENCE COULEUR (un swatch, une photo, un échantillon de matière — peu importe la composition, seule la couleur et la texture de matière comptent).

═══════════════════════════════════════════
TÂCHE
═══════════════════════════════════════════

Recolorier l'addon (Image 1) avec la COULEUR et la TEXTURE de matière de la référence (Image 2). Le rendu final = la forme exacte de l'Image 1 + la couleur/finition exacte de l'Image 2.

RÈGLES STRICTES :
- PRÉSERVE la forme, les proportions, l'angle de vue, l'éclairage, le fond, l'ombre de l'addon de l'Image 1 — pixel-faithful.
- PRÉSERVE intégralement toute gravure, motif, sertissage, décor, texte présent sur l'addon — ne pas modifier les détails, juste la couleur du fond métallique.
${surfaceRule}
- Si l'Image 2 montre une finition brossée → addon brossé. Si miroir poli → addon poli. Si sablé/mat → sablé/mat. Si anodisé pastel → anodisé pastel. Reproduire fidèlement la TEXTURE de surface, pas juste la teinte moyenne.
- Si des pierres, zircons, diamants, perles sont présents sur l'addon original → les conserver EXACTEMENT comme dans l'Image 1 (pas de recoloration des pierres).
- Si une gravure noire ou colorée est présente → la conserver dans sa couleur d'origine.
- Pas de changement de forme, pas de changement d'angle, pas de changement de taille, pas d'ajout d'éléments.

${note && note.trim() ? `\n📝 NOTE ADDITIONNELLE DE L'UTILISATEUR (à respecter) :\n${note.trim()}\n` : ""}

═══════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════

Une seule photo : l'addon original avec la nouvelle couleur/finition de la référence, qualité photo magazine, ultra-net, fond et éclairage identiques à l'Image 1.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: a.mimeType, data: a.data } },
          { inlineData: { mimeType: c.mimeType, data: c.data } },
          { text: prompt },
        ] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
        },
      }),
    });
    const respText = await r.text();
    let respData: { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }>; promptFeedback?: { blockReason?: string }; error?: { message?: string } };
    try { respData = JSON.parse(respText); }
    catch { return NextResponse.json({ error: `Gemini non-JSON (HTTP ${r.status}) : ${respText.slice(0, 200)}` }, { status: 502 }); }

    if (!r.ok) {
      return NextResponse.json({ error: `Gemini ${r.status} : ${respData?.error?.message || ""}` }, { status: 502 });
    }
    const candidate = respData?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return NextResponse.json({ error: `Gemini a refusé (finishReason : ${candidate.finishReason}).` }, { status: 502 });
    }
    if (respData?.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `Bloqué par les filtres (${respData.promptFeedback.blockReason})` }, { status: 502 });
    }
    const partsOut = (candidate?.content?.parts || []) as Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
    const imagePart = partsOut.find(p => p.inlineData?.mimeType?.startsWith?.("image/"));
    if (!imagePart?.inlineData?.data) {
      const textPart = partsOut.find(p => p.text);
      return NextResponse.json({ error: textPart?.text ? `Gemini a répondu par texte : « ${textPart.text.slice(0, 150)} »` : "Pas d'image en sortie" }, { status: 502 });
    }
    await incrementGeminiImageCount();
    return NextResponse.json({ image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
