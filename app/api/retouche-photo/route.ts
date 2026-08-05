import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { recordGeminiImages } from "@/lib/gemini-counter";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3-pro-image-preview";

// Référence d'angle hardcodée pour certaines actions (sélection aléatoire entre variantes)
// Référence d'angle hardcodée pour certaines actions
// NOTE : fond-blanc désactivé car Gemini fusionnait les designs des 2 bagues.
// L'angle est forcé via le prompt texte uniquement.
const ACTION_REFS: Record<string, { folder: string; count: number }> = {
  // "fond-blanc": { folder: "fond-blanc", count: 6 },
};

function loadActionReference(action: string): { inlineData: { mimeType: string; data: string } } | null {
  const ref = ACTION_REFS[action];
  if (!ref) return null;
  const idx = Math.floor(Math.random() * ref.count) + 1;
  const refPath = path.join(process.cwd(), "public", "refs", ref.folder, `fb-${idx}.jpg`);
  if (!existsSync(refPath)) return null;
  try {
    const buffer = readFileSync(refPath);
    return { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } };
  } catch {
    return null;
  }
}

export const PROMPTS: Record<string, string> = {
  "fond-blanc": "Take THIS EXACT RING from the attached image and place it on a pure white catalog background, in Mood Collection signature catalog pose. Pixel-precise design preservation is the #1 priority.\n\n⛔ THE RING'S DESIGN MUST BE PRESERVED EXACTLY — IDENTICAL, PIXEL-PRECISE.\n- Same EXACT shape and silhouette.\n- Same EXACT colors and materials (steel, titanium, aluminum, gold, etc.).\n- Same EXACT decoration : count and preserve every single decoration element. If the ring has 4 rows of pavé diamonds, output 4 rows. If it has 26 gemstones, output 26 gemstones. If it has engraved mountain peaks with diamonds inside, output mountain peaks with diamonds inside.\n- Same EXACT pattern, motif, gemstones, prongs, engravings, surface finish.\n- DO NOT simplify the decoration. DO NOT reduce the number of rows / gemstones / details. DO NOT reinterpret a 3D relief as flat engraving. DO NOT change pavé to channel-set. DO NOT remove design elements to simplify.\n- DO NOT redesign anything. If you cannot perfectly reproduce a decoration element, copy it EXACTLY from the source rather than approximating.\n\n📐 ANGLE & FRAMING — Mood catalog signature :\n- Camera at near eye-level with a slight downward tilt (about 10-15° plunge).\n- The ring is laid flat horizontally on the (invisible) surface.\n- The ring is slightly tilted in 3/4 perspective so you can see :\n  · The decorated outer band-surface on TOP (visible in slight foreshortening).\n  · The polished inner hole as a HORIZONTAL OVAL visible on the right side (or left, your choice based on which side of the ring is most informative).\n  · A hint of the side profile at the front.\n- Format: SQUARE 1:1.\n- The ring fills 85-95% of the frame width, centered.\n\n✂️ PIXEL-PRECISE CUTOUT on PURE WHITE :\n- 100% pure white background (#FFFFFF) — exactly RGB 255,255,255. NOT gray, NOT off-white, NOT cream.\n- Cut at the EXACT pixel boundary of the ring. No fuzzy edge, no halo, no colored fringe, no semi-transparent pixels.\n- Preserve every intricate detail: engravings, gemstones, prongs, small openings, the inner ring hole (background shows through it as pure white).\n- NO cast shadow on the (invisible) surface. The ring's own 3D self-shadow (modeling the band's volume) stays.\n\n✨ CLEANING (apply during the re-photograph) :\n- Remove all dust, lint, fingerprints, scratches, surface marks, fluff, water spots, residues, oily traces.\n- 🔧 THE BASE RAILS (the two polished metal stripes flanking the addon) must be NICKEL-MIRROR-POLISHED CLEAN — completely flawless, like a wedding band fresh from the final polish. ZERO scratches, ZERO marks, ZERO traces, ZERO dust visible on the rails. Sharp specular highlights and smooth gradients.\n- Gemstones sparkle clean and brilliant.\n- ⛔ Cleaning does NOT mean redesigning. Only remove parasites (dust, scratches, dirt) — never alter the design.\n\n🎨 INTERIOR COLOR MATCH (Mood ring specificity) :\n- IF the base of the source ring is COLORED (titanium anodized blue, pink, violet, gold, black, etc.) → the inner band of the ring visible through the hole is the SAME COLOR as the outer base. Anodized titanium is colored all around.\n- IF the base is NEUTRAL STEEL 316L → the inner band is silver polished steel.\n- DO NOT make the interior steel/silver when the base exterior is colored titanium. They MUST match.\n\n🎯 ADDON-BASE STRUCTURE (Mood ring anatomy) :\n- The addon (decorated central band) fills the ENTIRE central groove between the two polished metal rails of the base.\n- No overflow beyond rails, no gaps between addon and rails.\n- Addon and rails are FLUSH at the same surface height (no relief / no step / no shadow groove).\n- Addon has uniform width along the entire visible length.\n- Upper rail = lower rail (mirror-symmetric widths, addon centered vertically).\n\n💡 Lighting : even soft studio illumination, subtle gradient reflections on polished metal — no harsh hotspots, no flat ringlight, just clean even product light revealing every design detail.\n\n📏 Ring proportions identical to source — same overall band thickness, same width balance between rails and addon.\n\n⛔ ABSOLUTE BANS :\n- NO gray/off-white/cream background.\n- NO cast shadow on the surface.\n- NO redesigning, simplifying, or reinterpreting the ring's decoration.\n- NO reduction in the number/complexity of design elements.\n- NO changes to gemstones, materials, colors, or engravings.",
  "fond-anthracite": "Place this subject on a clean, uniform anthracite dark gray background (color hex #292928, the same dark studio background used in Mood Collection product photography). Keep the subject exactly as is — same colors, lighting, shadows, position and composition. Only the background is replaced with the uniform anthracite color. Professional packshot style, centered, studio lighting feel.",
  "amelioration": "Professional packshot retouching of this Mood Collection ring photo. Generate a CLEANED and STRAIGHTENED version with the following corrections:\n\n1. CLEAN ALL IMPERFECTIONS on the ring surface : dust particles, fingerprints, fine scratches, surface marks, lint fibers, smudges, micro-stains. The ring must look pristine and brand new, as if it just came out of the factory polishing stage.\n\n2. STRAIGHTEN THE RING : if it's tilted or off-axis, rotate it gently so it sits perfectly aligned with the natural horizontal/vertical of the photo. Center it in the frame with comfortable margins on all sides.\n\n3. ENHANCE THE METAL/MATERIAL : preserve and highlight the natural texture (brushed, polished, anodized, etc.), keep faithful colors, boost contrast subtly to make edges crisp, sharpen reflective highlights without overdoing it.\n\n4. KEEP IDENTICAL : the background, the lighting direction, the overall composition style, the ring identity (same shape, same color, same material, same finish, same gemstones).\n\nThe result must look like a professional jewelry photographer just retouched it for a high-end e-commerce listing. Output the cleaned and straightened image, not the original.",
  "lumiere-contraste": "HIGH-QUALITY PROFESSIONAL ENHANCEMENT of this Mood Collection ring photo for luxury jewelry magazine quality. Apply the following corrections on the WHOLE image :\n\n1. LIGHTING : significantly improve exposure dynamics, recover shadow details, control highlights, add a subtle directional studio lighting feel. The ring should have crisp, well-defined highlights and rich, deep shadows for a 3D feel.\n\n2. CONTRAST : boost contrast clearly — deep blacks, bright whites, full tonal range. Avoid flat washed-out look.\n\n3. CLEAN PARASITES EVERYWHERE — both on the ring AND in the surrounding decor/background : dust particles, fingerprints, fine scratches, lint, fibers, hair strands, marks, smudges, micro-stains. The surface, fabric, support, background must look pristine.\n\n4. CLEAN DECOR IMPERFECTIONS : fix any wrinkles in fabric, dirt on surface, color inconsistency in background, dust on plant leaves, water spots, smudges on glass, any visual distraction.\n\n5. INCREASE SHARPNESS and clarity selectively on the ring edges and gemstones for that high-end magazine look.\n\n6. KEEP IDENTICAL : composition, ring identity, decor style, color palette intent.\n\nResult : a high-end luxury jewelry photography look, ready for a glossy magazine or a high-end e-commerce hero shot. Output the enhanced image.",
  "theme-printemps": "TRANSFORM the surroundings of this Mood Collection ring into an ELEGANT SPRING LUXURY scene while keeping the ring exactly identical (same shape, color, material, finish, gemstones, exact position).\n\nSpring decor :\n- Soft sakura cherry blossom petal shadows playing on the surface around the ring (silhouettes, not actual petals — like sunlight filtering through cherry blossoms casting delicate shadow patterns)\n- A few real sakura petals scattered subtly around the ring (pale pink, cream)\n- Soft warm MORNING LIGHT (golden hour just after sunrise, warm but not overly golden — fresh and gentle)\n- Light pastel palette in shadows : pale pink, cream, light peach, soft white\n- A subtle hint of out-of-focus spring greenery in the deep background (bokeh, very soft)\n- High-end luxury jewelry magazine style, like a Tiffany or Cartier spring campaign\n- Clean surface (no dust, no parasites)\n\nResult : a luxe spring editorial shot, the ring as the hero, sakura ambiance subtle and elegant. Output the transformed image.",
  "theme-ete": "TRANSFORM the surroundings of this Mood Collection ring into an ELEGANT SUMMER LUXURY scene while keeping the ring exactly identical (same shape, color, material, finish, gemstones, exact position).\n\nSummer decor :\n- Warm golden hour light (late afternoon, rich amber tones)\n- Subtle sandy/sun-bleached texture on the surface (suggested, not explicit — like fine pale sand or warm linen)\n- Soft palm leaf or tropical foliage shadows playing across the scene (silhouettes, dappled light)\n- A few subtle elements : maybe one delicate seashell or a single small pebble nearby, very subdued\n- Warm color palette : honey, cream, beige, soft coral, pale gold\n- Out-of-focus warm bokeh in deep background suggesting an outdoor summer setting\n- High-end luxury jewelry magazine style, like a summer campaign\n- Clean surface (no dust, no parasites)\n\nResult : a luxe summer editorial shot, the ring as the hero, vacation/sun-kissed ambiance subtle and elegant. Output the transformed image.",
  "theme-automne": "TRANSFORM the surroundings of this Mood Collection ring into an ELEGANT AUTUMN LUXURY scene while keeping the ring exactly identical (same shape, color, material, finish, gemstones, exact position).\n\nAutumn decor :\n- A few real autumn leaves scattered around the ring (subtle, not cluttering) : warm terracotta, ochre, burnt orange, golden yellow — fall colors\n- Soft warm afternoon light, slightly low-angle, casting long gentle shadows\n- A hint of cozy texture nearby (warm wool, cashmere, linen in autumn tones)\n- Rich warm color palette : terracotta, ochre, burnt umber, deep ruby, golden brown\n- Out-of-focus warm bokeh in deep background suggesting indoor cozy autumn setting\n- High-end luxury jewelry magazine style, like a fall campaign\n- Clean surface (no dust, no parasites)\n\nResult : a luxe autumn editorial shot, the ring as the hero, cozy fall ambiance subtle and elegant. Output the transformed image.",
  "theme-hiver": "TRANSFORM the surroundings of this Mood Collection ring into an ELEGANT WINTER LUXURY scene while keeping the ring exactly identical (same shape, color, material, finish, gemstones, exact position).\n\nWinter decor :\n- Subtle frost or fine snow crystals texture on the surface around the ring (delicate, not heavy)\n- Cool soft light (overcast winter daylight or warm candle light contrasting with cool tones)\n- Cool color palette in highlights : icy white, pale blue, silver, soft pearl — with optional warm candle/golden contrast accent\n- A few subtle elements : maybe a sprig of evergreen (pine, eucalyptus) or a small frost-bitten branch, very subdued\n- Out-of-focus cool bokeh in deep background suggesting winter ambiance\n- High-end luxury jewelry magazine style, like a winter campaign\n- Clean surface (no dust, no parasites)\n\nResult : a luxe winter editorial shot, the ring as the hero, crisp winter ambiance subtle and elegant. Output the transformed image.",
  "theme-terre-dombre": "TRANSFORM the surroundings of this Mood Collection ring into a JACQUEMUS-STYLE TERRE D'OMBRE LUXURY EDITORIAL scene while keeping the ring exactly identical (same shape, color, material, finish, gemstones, exact position).\n\nTerre d'ombre — Jacquemus-inspired editorial decor :\n- Setting : contemporary Mediterranean architecture — terracotta clay walls with textured warm-sand plaster (enduit texturé couleur sable chaud), simple sculptural architectural volumes (a corner, a step, an arch fragment, a niche, a raw clay ledge).\n- Light : LATE AFTERNOON GOLDEN LIGHT entering FROM THE SIDE (low-angle, ~25-40° from horizontal), warm and dramatic — like the last hour before sunset in a Provence/Greek island/Moroccan courtyard.\n- Shadows : DEEP, GRAPHIC, BOLD shadows projected on the surfaces — clear hard-edged shadow shapes (Jacquemus signature). HIGH CONTRAST between brightly-lit warm zones and deep shadow zones (some areas fully sunlit warm cream, others sinking into deep brown/black shadow).\n- Color palette : warm terracotta, sand beige, burnt sienna, warm brown, ochre, copper — with DEEP BLACK / dark brown shadows. NO white seamless studio backdrop.\n- Mood : cinematic, editorial, elegant, mysterious, artisanal, raw yet refined.\n- Style references : Jacquemus summer campaign, Loewe earth-tone editorial, Bottega Veneta minimalist sculptural, raw Mediterranean luxe.\n- Materials in the scene : raw natural textures — unglazed clay, sand plaster, smooth warm stone, possibly a subtle out-of-focus natural linen drape in the deep background.\n- Surface where the ring sits : a raw terracotta step / sand-plaster ledge / warm clay architectural element catching the golden light and casting a clean bold shadow.\n- NO literal sand, NO palm trees, NO sea, NO landscape — the decor is SCULPTURAL ARCHITECTURE, not nature.\n- Composition : minimalist, sculptural, sophisticated — the ring as hero, decor as elegant geometric play of light and shadow on warm earthen surfaces.\n- Clean ring surface (no dust, no parasites).\n\nResult : a luxe terre-d'ombre editorial shot in the visual language of a Jacquemus summer campaign — the ring as the hero on a warm clay/terracotta surface, dramatic side-lit golden light, deep graphic shadows, sophisticated minimalist composition. Output the transformed image.",
  "coffret": "MOOD COFFRET PRESENTATION — Re-photograph THIS EXACT RING placed inside a Mood Collection presentation coffret, in the signature Mood coffret photography style. Pixel-precise design preservation is mandatory.\n\n⛔ THE RING'S DESIGN MUST BE IDENTICAL TO THE SOURCE :\n- Same exact shape, colors, materials, finish, gemstones, engravings, pattern.\n- Count and preserve every decoration element (rows of pavé, gemstones, addon bands, motifs).\n- DO NOT simplify, redesign, reinterpret, or remove any design element.\n- If base is colored titanium (anodized blue, pink, violet, gold, black) → interior is the SAME color (titanium is anodized all around). If base is steel 316L → interior is polished silver steel.\n\n📐 ANGLE & FRAMING (Mood coffret signature — ORIENTATION LOCKED) :\n- Camera at near eye-level with a slight downward tilt (~5-15° plunge).\n- 🚨 ORIENTATION RULE (NON-NEGOTIABLE — ALWAYS THE SAME WAY, every coffret photo identical orientation) :\n  • The ring is STANDING UPRIGHT ON ITS BOTTOM EDGE on the white leatherette cushion (like a tire standing on the ground — NOT lying flat, NOT tilted on its side).\n  • The circular axis of the ring is HORIZONTAL : the ring opening (hole) faces toward the RIGHT side of the frame.\n  • The DECORATED / COLORED OUTER BAND surface is fully visible on the LEFT-FRONT, facing the camera.\n  • The POLISHED SILVER INTERIOR (inner hole) is visible on the RIGHT as a soft oval opening catching the light.\n  • Subtle 3/4 angle : outer band curves from front-left toward back-right, like looking at the side profile of a wheel from slightly in front.\n- The ring is in CRISP SHARP FOCUS at the front-center where the decorated band is most visible.\n- Format: SQUARE 1:1.\n- 🔍 RING SIZE — THE RING IS BIG, FILLING THE FRAME : the ring fills 85-95% of the frame WIDTH (the ring is wider than tall because it stands on its edge horizontally). The ring almost TOUCHES the left and right edges of the frame (within 2-5% margin). Only a thin strip of cushion is visible above and below. The cushion/coffret background is BARELY visible — the ring DOMINATES the composition. Hero shot, generous zoom — NOT a small object floating in a big empty cushion.\n\n📊 ASCII ORIENTATION SCHEMATIC (the EXACT orientation expected — every shot identical) :\n         _________\n        / DECORATED \\\\    ← outer band (colored/decorated) on LEFT\n       |  OUTER     |\n       |  BAND      |  )   ← polished silver interior opening on RIGHT\n       |  (front)   |\n        \\\\___________/\n        ─────────────       ← ring stands on its bottom edge on white cushion\n\n🪞 COFFRET BACKGROUND & SURFACE (CRITICAL — the Mood signature setting) :\n- The ring is placed inside an OPEN MOOD COFFRET (presentation box) made of soft padded white leatherette (skai blanc capitonné).\n- The surface is SOFT WHITE / OFF-WHITE LEATHERETTE with subtle quilted/padded relief — gentle curves, soft cushion-like texture visible but blurred.\n- Background : SLIGHTLY OUT-OF-FOCUS continuation of the white leatherette interior of the coffret. The atmosphere is calm, premium, clean.\n- No other props, no logos, no text. Just the coffret interior.\n\n💡 LIGHTING — soft diffused window light from the side :\n- ONE soft diffused light source from the upper-left at ~45° angle.\n- Creates a gentle highlight on the upper edge of the ring, soft gradient shadow on the lower-right side.\n- The polished metal of the inner band catches subtle reflections.\n- Mood : calm, intimate, like a jewelry presentation box opened in soft daylight.\n- NO harsh studio strobe, NO hotspots, NO ringlight, NO flat overhead.\n\n✨ CLEANING (pristine quality) :\n- Remove all dust, lint, fingerprints, scratches, surface marks, fluff, water spots, residues, oily traces.\n- 🔧 The base rails (polished metal stripes flanking the addon) must be NICKEL-MIRROR-POLISHED — flawless, no scratches, no marks, no traces.\n- Polished metal surfaces are MIRROR-CLEAN with crisp clean reflections.\n- Gemstones sparkle clean and brilliant.\n\n🎯 ADDON-BASE STRUCTURE :\n- Addon fills the entire central groove between rails, no overflow, no gaps, flush at the same surface height.\n- Addon uniform width along the entire visible length.\n- Upper rail = lower rail (mirror-symmetric, addon centered).\n\n⛔ ABSOLUTE BANS :\n- NO redesigning, simplifying, or reinterpreting the ring's decoration.\n- NO white seamless studio background — must be the textured coffret interior.\n- NO hands, no people, no other objects.\n- NO logos, no text.",

  "bague-portee": "Transform this Mood Collection ring photo into a HIGH-END EDITORIAL CLOSE-UP photograph of the ring BEING WORN on a hand, in the style of a luxury jewelry magazine campaign (Cartier / Tiffany / Bvlgari aesthetic).\n\n1. THE RING : keep it absolutely identical to the source — same shape, same colors, same material, same finish, same gemstones, same engravings if any, same proportions. The ring is the hero of the photo, perfectly sharp, well-lit.\n\n2. HAND (default if no user specification) : elegant feminine hand, well-manicured nails (subtle clean french or natural color), tan/olive skin tone, no jewelry on other fingers that distracts. Soft natural pose : the hand can be resting against the opposite arm, near the collarbone/jawline, close to the face partially veiling it, or naturally on a soft surface.\n\n3. OUTFIT in soft background focus : a simple white t-shirt OR cream/beige cashmere sweater OR delicate black blazer — never the main attention, always supportive.\n\n4. CADRAGE : tight close-up on the ring + hand, the ring takes 30-50% of frame, perfect focus on the ring (sharp), shallow depth of field (background blurred), warm directional studio light flattering the skin.\n\n5. LIGHTING : soft, warm, slightly directional — like a beauty shot. Catches the ring's highlights beautifully. Skin looks healthy and glowing.\n\n6. BACKGROUND : neutral, soft-focused, supportive of the ring (e.g., out-of-focus skin/clothing/wall). No distracting elements, no clutter, no logo, no text.\n\n7. STYLE : high-end editorial, magazine-grade, sophisticated, intimate, contemporary. Like an Instagram post from a luxury jewelry house.\n\nIf the user provides specific instructions (skin tone, nail style, hand pose, outfit, framing) in the additional instructions section, FOLLOW THEM PRECISELY as override of the defaults above. The ring stays the absolute hero. Output the worn-ring editorial photograph.",
  // Multi-formats : reframe pour un ratio précis
  "redimensionner-bague": "🚨 REDIMENSIONNER LA(LES) BAGUE(S) — convert the attached Mood Collection ring(s) to a NARROWER (or WIDER) band width WITHOUT modifying the design.\n\n═══════════════════════════════════════════\n🪞 IF MULTIPLE RINGS IN THE SOURCE PHOTO\n═══════════════════════════════════════════\n\nIf the source photo shows MULTIPLE rings (stacked, lined up, in a pile, grouped together) :\n- Count them carefully. The OUTPUT must show EXACTLY THE SAME NUMBER of rings as the source (e.g. 13 rings in → 13 rings out, never more, never less).\n- Convert EACH ring individually to the target band width.\n- PRESERVE the arrangement, order, position, spacing of each ring exactly.\n- PRESERVE each ring's individual color / finish / decoration identity (e.g. if source = rainbow stack with red/orange/yellow/green/turquoise/blue/violet/pink, output keeps exactly those same colors in exactly the same order).\n- The composition (stack, pile, line, group) looks identical EXCEPT each ring is now the new band width.\n\n═══════════════════════════════════════════\n🚨 DESIGN PRESERVATION (NON-NEGOTIABLE)\n═══════════════════════════════════════════\n\n- Same exact ring identity : same material, same color, same finish, same gemstones, same decoration pattern.\n- The DECORATIVE MOTIFS (bubbles, circles, dots, gemstones, ornaments) must keep their EXACT SHAPE — round bubbles stay perfectly ROUND, NEVER stretched into ovals, NEVER squished.\n- Each motif maintains its original aspect ratio (a 2mm round bubble stays a 2mm round bubble, not a 2x1.3mm oval).\n\n═══════════════════════════════════════════\n📐 BAND WIDTH CHANGE\n═══════════════════════════════════════════\n\nThe SOURCE width and TARGET width are specified in the user note below. You must :\n- Reduce (or increase) ONLY the band's vertical width (the thickness of the band when viewed from the side).\n- Keep the ring's overall DIAMETER unchanged (same finger size, same circumference).\n- Adapt the placement / count of the motifs to fit the new band width naturally :\n  • If reducing width : the motifs might need to be smaller (proportionally), OR fewer motifs fit on the narrower band — but each motif KEEPS its original round/circular shape.\n  • If increasing width : add proportionally more space around motifs, OR larger motifs (still same shape, just scaled).\n- The motif arrangement should look natural and balanced on the new band.\n\n═══════════════════════════════════════════\n📷 PHOTO STYLE PRESERVATION\n═══════════════════════════════════════════\n\nKeep the same photographic style as the source : same camera angle, same lighting, same background, same shadow direction, same color grading. The output looks like the SAME photo of a NARROWER version of the same ring.\n\n═══════════════════════════════════════════\n⛔ ABSOLUTE BANS\n⛔ NO ovalization of round motifs.\n⛔ NO design simplification or reinterpretation.\n⛔ NO change to material / color / finish / gemstones.\n⛔ NO change to camera angle or lighting style.\n⛔ NO text, logo, watermark.\n\n🎯 OUTPUT : a photograph of the same ring with the new band width, design pixel-preserved, motifs perfectly round, ready for catalog use.",

  "produit-multiple": "🚨 MULTI-RING EDITORIAL COMPOSITION — Create a SINGLE image showing ALL the attached Mood Collection rings composed together in ONE editorial scene.\n\n═══════════════════════════════════════════\n🚨 PIXEL-IDENTITY PRESERVATION (NON-NEGOTIABLE)\n═══════════════════════════════════════════\n\nEach ring shown in the attached reference images must be reproduced PIXEL-IDENTICAL in the output :\n- Same exact shape, size, color, material, finish, gemstones, pattern, addon, decoration.\n- DO NOT redesign, simplify, merge, or duplicate rings.\n- Count the reference images : if 4 references are attached, show EXACTLY 4 different rings in the output (one per reference). Never invent extra rings.\n\n═══════════════════════════════════════════\n📐 DISPOSITION — DISPERSED EDITORIAL (campagne magazine, NOT grid)\n═══════════════════════════════════════════\n\n- Disperse the rings NATURALLY across the scene — NOT aligned in a grid, NOT in a perfect row, NOT stacked.\n- Each ring positioned at a different height / angle / depth — some standing upright, some lying flat, some leaning, on slightly different planes.\n- Composition feels like a luxury jewelry magazine campaign : artistic, balanced, breathing negative space between rings.\n- Hierarchy : one ring can be slightly more prominent in the foreground (focal point), others supporting around it.\n- Rings DO NOT touch or overlap — they have breathing space.\n- Total composition is harmonious, the eye travels naturally between rings.\n\n═══════════════════════════════════════════\n🌐 CONSISTENT SCENE\n═══════════════════════════════════════════\n\n- ALL rings share the SAME LIGHTING, SAME SURFACE / ENVIRONMENT, SAME ATMOSPHERE.\n- Default lighting : soft directional studio light (overridden by active theme if applicable).\n- Default background : neutral white seamless surface with subtle shadow (overridden by active theme if applicable).\n- All rings perfectly sharp, mirror-clean, gemstones brilliant, no dust no parasites.\n\n🎯 OUTPUT : a single editorial composition image, magazine print quality, all rings clearly visible and identifiable.",
  "multi-1-1": "Recompose this image for a 1:1 square aspect ratio (Instagram post). Keep the main subject perfectly centered and well-framed. Extend the background intelligently (matching its existing style, color, texture and lighting) to fit the new square dimensions. The subject stays exactly the same.",
  "multi-4-5": "Recompose this image for a 4:5 portrait aspect ratio (Instagram feed portrait). Keep the main subject perfectly centered, with comfortable margin top and bottom. Extend the background intelligently (matching its existing style and lighting) to fit the new portrait dimensions. Subject preserved.",
  "multi-9-16": "Recompose this image for a 9:16 vertical aspect ratio (Instagram Story / Reel / TikTok). Keep the main subject perfectly centered, with extra space top and bottom. Extend the background intelligently (matching existing style, lighting, gradient) to fit the new tall portrait dimensions. Subject preserved.",
  "multi-16-9": "Recompose this image for a 16:9 landscape aspect ratio (Facebook cover, web banner). Keep the main subject centered with comfortable space on left and right. Extend the background intelligently (matching existing style and lighting) to fit the new wide dimensions. Subject preserved.",
};

const RATIOS: Record<string, string> = {
  "fond-blanc": "1:1",
  "fond-anthracite": "1:1",
  "amelioration": "1:1",
  "lumiere-contraste": "1:1",
  "theme-printemps": "1:1",
  "theme-ete": "1:1",
  "theme-automne": "1:1",
  "theme-hiver": "1:1",
  "theme-terre-dombre": "1:1",
  "bague-portee": "1:1",
  "coffret": "1:1",
  "redimensionner-bague": "1:1",
  "produit-multiple": "1:1",
  "multi-1-1": "1:1",
  "multi-4-5": "4:5",
  "multi-9-16": "9:16",
  "multi-16-9": "16:9",
};

// Thèmes globaux — overlay ajouté à n'importe quel prompt d'action quand l'utilisateur sélectionne un thème en haut
export const THEME_OVERLAYS: Record<string, string> = {
  "lifestyle": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "LIFESTYLE" (photo souvenir voyage authentique non-studio)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : Photo NATURELLE NON STUDIO. Décor VIVANT en arrière-plan (un environnement réel — café, terrasse, plage, montagne, rue, intérieur cozy — selon ce qui fait sens). PAS de seamless backdrop, PAS de fond uni studio.
- Light : LUMIÈRE DU JOUR RÉELLE (sun, overcast, golden hour selon le contexte), authentique, non-artificielle.
- Mood : SPONTANÉ ET AUTHENTIQUE, ambiance "daily life", style SOUVENIR DE VOYAGE, rendu simple et réaliste, sensation d'instant capturé sur smartphone (mais en qualité premium).
- Style references : Pinterest lifestyle, Instagram authentique, daily life photography, travel memory.
- Profondeur de champ légère naturelle (pas studio shallow DOF — DOF moyen comme un smartphone moderne).

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a COFFRET / BOX shot : the white coffret photographed naturally in a real environment (sur une table de café, sur une commode, sur un drap), lumière du jour, ambiance souvenir spontané.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with a REAL ENVIRONMENT — la bague posée sur une surface naturelle (table, livre, drap, sable, herbe) avec un arrière-plan vivant légèrement flou, lumière du jour réelle, photo spontanée premium.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- TIGHT close-up but with NATURAL lifestyle aesthetic (smartphone-quality framing élevé en qualité premium).
- The real environment decor is a SUPPORTING BACKDROP — out-of-focus mais reconnaissable.
- The ring is the absolute focus subject — perfectly sharp.`,

  "in-the-mood-for": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "IN THE MOOD FOR" (soft luxury cozy Pinterest editorial)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : Photo produit lifestyle premium, décor MINIMALISTE CHALEUREUX ET ÉLÉGANT. Surface BEIGE CLAIR (papier mat, lin, ou bois clair beige). Arrière-plan TEXTILE CRÈME légèrement flou (drapé soie, lin, cachemire crème).
- Light : LUMIÈRE NATURELLE DOUCE ET CHAUDE, almost-solar diffuse, golden hour interior glow.
- Shadows : DÉLICATES, soft falloff, no harsh contrast.
- Color palette : BEIGE, CRÈME, NUDE, IVOIRE, soft taupe, with warm cream highlights. Monochromatic warm neutrals.
- Profondeur de champ très faible (very shallow DOF), bokeh CRÉMEUX en arrière-plan.
- Mood : COSY ET LUXE MODERNE, SOFT LUXURY CONTEMPORAINE, Pinterest éditorial, textures DOUCES ET RAFFINÉES, esthétique minimaliste féminine, composition épurée et harmonieuse.
- Style references : Pinterest soft luxury, Anine Bing, Khaite cozy, contemporary minimal feminine.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a COFFRET / BOX shot : the white coffret on warm beige surface, draped soft cream fabric in background, soft warm natural light, delicate shadows, cozy soft luxury.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with warm beige surface + cream textile drape in soft-focus background, very shallow DOF, ring sharp in foreground, soft warm natural light, delicate shadows.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- The beige/cream cozy decor is a SUPPORTING BACKDROP, heavily blurred bokeh.
- The ring is the absolute focus subject — perfectly sharp.
- Camera : zoom in tight. Soft luxury decor is silent warm minimalism, never competing.`,

  "pastel": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "PASTEL" (luxe minimaliste / anneaux assortis bokeh)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : Photo macro produit haut de gamme. Surface en BOIS CLAIR NATUREL (chêne clair, hêtre, érable — matte naturel, légèrement texturé).
- Arrière-plan composé UNIQUEMENT d'ANNEAUX COLORÉS reprenant exactement la même couleur, la même texture, la même taille et la même largeur que l'anneau central de la bague principale (extracted from the ring's center band), SANS les bordures métalliques visibles.
- Les anneaux en arrière-plan sont disposés ALÉATOIREMENT de façon naturelle et harmonieuse — certains DEBOUT, certains COUCHÉS, créant une composition organique et équilibrée.
- Light : LUMIÈRE STUDIO DIFFUSE ET CHALEUREUSE (warm soft daylight), almost-solar, cinematographic gentle.
- PROFONDEUR DE CHAMP TRÈS FAIBLE (very shallow DOF) avec arrière-plan FORTEMENT FLOU, bokeh DOUX ET CRÉMEUX.
- Focus ULTRA PRÉCIS sur la bague centrale (le ring du source pixel-identical).
- Color palette : palette pastel inherited from the ring's center color (same hue), with warm wood undertones and cream highlights.
- Mood : minimaliste premium, éditorial luxe moderne, organique et harmonieux.
- Style references : éditorial luxe moderne, macro 85mm f/2.8 aesthetic, premium product photography Pinterest style.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a COFFRET / BOX shot : the white coffret on the warm light wood surface, soft diffuse light, blurred pastel ring bokeh in background.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with warm light wood surface + soft pastel ring bokeh in deep background (anneaux assortis identiques à la bague centrale, sans métal visible, debout/couchés, naturellement dispersés), shallow DOF, ring sharp in foreground.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- Macro 85mm f/2.8 aesthetic — tight close-up with shallow DOF.
- The pastel ring bokeh decor is a SUPPORTING BACKDROP, heavily blurred, occupying ONLY the negative space.
- The ring is the absolute focus subject — perfectly sharp, crisp on the front.
- Camera : zoom in tight, macro precision. Pastel decor is silent organic harmony, never competing.`,

  "beton": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "BÉTON" (luxe urbain minéral / sculpté à la main)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : Studio photo minimaliste SOMBRE, textures métalliques organiques et SCULPTÉES À LA MAIN, inspiration ROCHE BRUTE et matière fondue.
- Fond : BÉTON ANTHRACITE TEXTURÉ (relief minéral subtil, dark gray cement wall with organic imperfections).
- Light : lumière CINÉMATOGRAPHIQUE DOUCE, single soft directional light from the side, creating gentle moody shadows.
- Shadows : delicate cinematic falloff, no harsh contrast, moody premium.
- Color palette : ANTHRACITE / DARK GRAY / CEMENT / minéral noir, with touches of warm metal highlights on the ring (gold / silver / copper depending on source).
- Mood : luxe artisanal, moderne et minéral, sculptural, premium urban, contemporary craft.
- Style references : Bottega Veneta architectural editorial, Maison Margiela material study, premium concrete craft.
- Composition : sobre et élégante, sculptural, beaucoup d'espace négatif.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a COFFRET / BOX shot : the white coffret on the dark anthracite concrete surface, soft cinematic side light, gentle shadow, moody minéral mood.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with anthracite concrete texture, the ring resting on a sculpted hand-crafted metallic / stone surface (organic relief), soft cinematic side light, gentle moody shadow.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- The concrete / sculpted minéral decor is a SUPPORTING BACKDROP, occupying ONLY the corners and negative space.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit.
- Camera : zoom in tight, macro precision. Minéral architectural decor is silent luxury, never competing.`,

  "zanzibar": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "ZANZIBAR" (luxe minimaliste océan / coquillage sculptural)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : Studio photo luxe minimaliste, décor blanc sculptural inspiré d'un coquillage, courbes organiques fluides, support en céramique blanche mate.
- Light : lumière naturelle DOUCE ET DIFFUSE, almost-solar, ambiance aérienne et élégante.
- Shadows : ombres DÉLICATES (pas dramatiques), soft falloff, gentle play of light on the matte ceramic surface.
- Color palette : WHITE / IVORY / CREAM monochrome, with subtle warm beige accents from the ceramic, soft golden highlights on the ring's metal.
- Mood : aerial, organic, oceanic, premium modern, contemporary minimalist, refined silence.
- Style references : luxe minimaliste contemporain, océan / coquillage / nacre, premium studio editorial.
- Decor accents (subtle, MAX 1-2 elements) : a single sculpted white shell-shape curve, a smooth matte ceramic ledge, an organic flowing form — ALWAYS white / ivory tones, NEVER colored.
- Composition : ULTRA MINIMALISTE, sculptural, beaucoup d'espace vide.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : ELEGANT WOMAN wearing a CRISP OVERSIZED WHITE SHIRT (chemise blanche oversize, soft cotton or poplin). Natural skin tone, gentle warm light. Tight close-up sur les mains et poignets, pose naturelle et détendue. Fond clair et épuré (white seamless or soft beige). Profondeur de champ légère. Tons chauds et lumineux. Style premium éditorial moderne, esthétique simple et raffinée. Très peu d'accessoires (no necklace, no bracelet competing). Ambiance douce et féminine.
- IF the action is a COFFRET / BOX shot : the coffret on a matte white ceramic ledge with sculptural organic shapes around, soft diffuse natural light, delicate shadows, oceanic minimalism.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with a sculptural white ceramic shell-inspired backdrop, the ring resting on a smooth matte ceramic surface, soft diffuse natural light, delicate shadows.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- The white ceramic / shell decor is a SUPPORTING BACKDROP, occupying ONLY the corners and negative space.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit.
- For worn-ring shots : ring + hand + portion of skin/shirt near the ring fill the frame ; the woman's body / oversize shirt are supporting, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision. Oceanic minimalism is silent luxury, never competing.`,

  "pur-white": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "PUR WHITE JOAILLERIE" (luxe cristallin — Swarovski / Dior / Vogue couture)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : ULTRA-LUMINOUS CRYSTALLINE editorial — frozen white or very pale pearl-gray background, pure aerial minimalist atmosphere.
- Light : INTENSE NATURAL DIRECTIONAL LIGHT creating PRISMATIC FLARES, subtle rainbow refractions, sharp crisp shadows, crystalline light plays projected on surfaces.
- Shadows : sharp + delicate, crystalline geometry, ice-like.
- Color palette : pure white, silver, crystal, icy gray, with micro IRIDESCENT REFLECTIONS (subtle rainbow flare). Monochromatic and clean.
- Mood : pure, aerial, ultra luxurious, cold/icy elegance, couture futuristic, silent luxury, spectacular light.
- Style references : Swarovski campaign, contemporary diamond photography, Dior haute joaillerie, Vogue couture editorial.
- Composition : SCULPTURAL and modern — extreme focus on the stone cuts, transparency, facet details. Subtle mirror reflections, satin surfaces, high-end diffused light.
- Ultra clean, ZERO unnecessary decor. Short depth of field, hyper-real, ultra-sharp.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : ELEGANT WOMAN in flowing TEXTURED WHITE FABRICS — couture pleated, light mousseline, matte satin, vaporous organza. Palette : cream monochrome, ivory, off-white, very light beige. Soft diffused almost-solar natural light, delicate shadows + subtle contrasts on the fabric and skin. Calm pure luxurious atmosphere. Optional : oversized sculptural hat, floating light veils, artistic minimalist composition. Hand near the ring as the absolute focus.
- IF the action is a COFFRET / BOX shot : the white coffret photographed on a frozen white / pearl gray background, intense directional natural light creating prismatic flares on the white leatherette and the ring inside, sharp crystalline shadow, ultra clean composition.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : background = frozen pure white or pale pearl gray, intense natural directional light creating prismatic light flares on the metal and stones, sharp crystalline shadow, rainbow micro-reflections on the surface.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- The pure-white crystalline decor is a SUPPORTING BACKDROP, occupying the negative space.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit, with crisp prismatic highlights on metal and stones.
- For worn-ring shots : ring + hand + portion of white fabric near the ring fill the frame ; the woman's body / couture fabric / hat are supporting, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision on the stone facets and metal. Crystalline decor is silent luxury cold elegance, never competing.`,

  "black-joaillerie": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "BLACK JOAILLERIE" (haute couture luxe — Cartier / Dior Haute Joaillerie / Vogue)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : MINIMALIST DARK STUDIO — deep black or anthracite gray gradient backdrop, no props, no decor, no texture, ULTRA CLEAN.
- Light : SINGLE INTENSE DIRECTIONAL LIGHT (single source from one side or above), sculptural — creating CINEMATIC HARD SHADOWS. Strong contrast between deep shadow zones and brightly illuminated subject.
- Shadows : dramatic, sculptural, cinematic — chiaroscuro lighting, like haute joaillerie campaigns. Deep blacks, bright highlights, very little mid-tones.
- Color palette : DEEP BLACK, anthracite gray, dark charcoal, with single sculptural skin/object highlights in warm or neutral tone. NO color elements.
- Mood : mysterious, powerful, timeless, sophisticated, silent elegance — NEVER glamour excessif or kitsch.
- Style references : Cartier haute joaillerie campaign, Dior Haute Joaillerie editorial, Vogue mode portrait, contemporary luxury jewelry magazine.
- Composition : ULTRA EPURÉE with MASSIVE NEGATIVE SPACE in deep black/gray. Subject occupies a precise zone, the rest is shadow.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : elegant woman, STATUESQUE ARTISTIC POSE inspired by haute joaillerie / haute couture campaigns. Elongated silhouette, elegant head carriage, slow refined gestures. DEEPLY LUMINOUS SATIN SKIN sculpted by intense directional light, bare shoulders, minimalist BLACK or MONOCHROME styling (sober structured or satin fabric). Deep black or anthracite background. Hand near the ring perfectly lit, body partially in shadow.
- IF the action is a COFFRET / BOX shot : the coffret is dramatically lit by a single directional light against a deep black background, sculptural shadow on one side, haute joaillerie product shot aesthetic.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with DEEP BLACK or ANTHRACITE GRADIENT, ring lit by single intense directional light creating sculptural highlights on metal and stones, deep cast shadow.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury haute joaillerie magazine product hero shot.
- The dark studio background is a SUPPORTING BACKDROP, occupying the negative space — pure deep black/gray.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit, with crisp sculptural highlights on metal and stones.
- For worn-ring shots : the ring + hand + portion of skin/fabric near the ring fill the frame ; the woman's body / shoulders are supporting, partially in shadow — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision. Dark studio decor is silent luxury, dramatic — never competing.`,

  "sakura": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "SAKURA" (luxe printanier minimaliste — Jacquemus / poésie cerisier)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : minimalist contemporary luxury spring universe — contemporary Mediterranean architecture, noble materials, sophisticated matte textures (pale plaster wall, smooth warm stone, soft drape).
- Light : SOFT MORNING LIGHT entering FROM THE SIDE, delicate and natural, creating FINE SAKURA BRANCH SHADOWS projected on the surfaces (silhouettes of cherry blossom branches — not literal petals, just shadow shapes filtering through unseen blossoming branches).
- Shadows : delicate, graphic, refined — sakura branch silhouettes drawn in shadow on the wall / surface / skin. The shadows are the only decorative element.
- Color palette : warm CREAM WHITE, warm BEIGE, very subtle POWDER PINK, pale stone, soft golden reflections — naturally elegant pastel palette. NEVER overly pink or kitsch.
- Mood : silent luxury, calm, aerial, poetic springtime, premium, clean, contemporary art / high-end magazine.
- Style references : Jacquemus spring campaign, contemporary luxury jewelry editorial, Dior poetic feminine minimal, Khaite spring.
- Decor accents (subtle, MAX 1 element) : just the delicate sakura branch shadow on the wall — nothing else. Ultra clean composition.
- Composition : ULTRA MINIMALIST with LOTS OF NEGATIVE SPACE, contemporary art-direction.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : elegant feminine hand delicately posed near a BARE SHOULDER, skin slightly bronzed and luminous, wearing a FLUID LIGHT-PINK DRESS (light airy spring fabric, subtle movement of the textile in the air). Soft warm morning natural light, FINE SAKURA BRANCH SHADOWS projected on the skin and on the dress. Palette : powder pink, warm beige, cream white, subtle gold. Romantic, fresh, premium — never kitsch.
- IF the action is a COFFRET / BOX shot : the white coffret on a pale stone or cream surface, soft morning side light, delicate sakura branch shadow falling across the coffret and surrounding, powder-pink tinted highlights very subtle.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace neutral background with cream / warm beige textured wall with delicate sakura branch shadow projected on it, ring on a matching matte stone surface, soft morning side light, subtle powder-pink reflections.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- The cream / pale stone decor with sakura shadows is a SUPPORTING BACKDROP, occupying ONLY the corners and negative space around the ring.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit.
- For worn-ring shots : the ring + hand + portion of skin/dress near the ring fill the frame ; the model's body / shoulder / dress are supporting, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision. Spring decor is silent luxury minimalism, never competing.`,

  "riviera": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "RIVIERA" (luxe estival méditerranéen — Cartier / Jacquemus / resort luxe)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

VISUAL DIRECTION :
- Setting : luxurious Mediterranean summer universe — fine WIND-SCULPTED SAND, CRYSTAL TURQUOISE WATER, PALE TEXTURED STONE (calcaire / travertin / pierre claire), intense GOLDEN LIGHT. Chic balnéaire haut de gamme.
- Light : strong direct MIDDAY MEDITERRANEAN SUN, creating SHARP GRAPHIC SHADOWS on surfaces. Moving aqua reflections from the pool water projecting bright luminous patterns on stone and skin.
- Shadows : crisp hard-edged shadow shapes from direct overhead sun.
- Color palette : warm sand beige, sun cream, pale turquoise, warm gold, caramel bronzed skin, mineral white — soft sophisticated solar palette.
- Mood : silent luxury, calm, summery, refined, sensual, exclusive Mediterranean vacation atmosphere.
- Style references : Cartier Riviera campaign, Jacquemus summer, contemporary luxury resort editorial, Mediterranean high-end magazine.
- Decor accents (subtle, MAX 1-2 elements per shot) : sand sculpted by the wind with relief texture, pool edge with aqua water reflections, pale stone surface with mineral relief, water droplets on skin, bronzed satin skin. NEVER cluttered.
- Composition : ULTRA MINIMALIST, lots of negative space, total focus on textures + light + jewelry.
- Filter : slightly warm-toned, gently desaturated, soft contrast, subtle film grain like luxury analog/argentique photography.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : ELEGANT WOMAN IN A PALE-STONE SWIMMING POOL, BRONZED SATIN SUN-KISSED SKIN, minimalist chic swimsuit (white / cream / pale turquoise / pale beige — single tone, sophisticated cut). Crystal turquoise water around her creating MOVING AQUA REFLECTIONS on her skin and the stone. OVERHEAD / PLUNGE camera view (from above looking down), refined sensual composition, midday natural light + sharp graphic shadows on body. Hair wet / loose / softly tied up — naturally undone, not styled. Hand near the ring as the absolute focus. NEVER kitsch — Vogue/Bottega editorial sensuality, never beach postcard.
- IF the action is a COFFRET / BOX shot : the white coffret on a pale stone edge or fine sand surface, intense midday Mediterranean light, sharp shadows, aqua reflections from a nearby pool optional in the background, premium resort feel.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace the neutral background with fine wind-sculpted sand surface OR pale calcaire / travertin stone edge with crystal turquoise pool water visible in the backdrop, ring resting on the warm sand or stone surface, midday sun casting crisp graphic shadow, aqua reflections playing on the surface.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot.
- Sand / water / pool / stone decor is a SUPPORTING BACKDROP, occupying ONLY the corners and negative space around the ring.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit, with crisp golden highlights and optional aqua reflections.
- For worn-ring shots : the ring + hand + portion of bronzed skin near the ring fill the frame ; the woman's body / pool / swimsuit are supporting, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision on the ring. The Mediterranean resort decor is silent luxury, never competing.`,

  "bora-bora": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "BORA BORA" (luxe estival lagon — sable rose orangé & ocre)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition.

AMBIANCE (prompt Mood, verbatim) :
Univers estival méditerranéen luxueux — sable fin rose orangé sculpté par le vent, lumière dorée intense. Ambiance chic balnéaire haut de gamme. Soleil méditerranéen direct en plein après-midi créant des ombres graphiques marquées sur les surfaces. Reflets aqua mouvants de l'eau de la mer projetant des motifs lumineux orangé sur la pierre et la peau. Palette : ocre, rose clair, sable chaud, crème solaire, rose pâle, or chaud, peau caramel bronzée, beige minéral — palette solaire douce et sophistiquée. Atmosphère : luxe silencieux, calme, estivale, raffinée, sensuelle, vacances méditerranéennes exclusives. Inspiration : campagne Cartier Riviera, été Jacquemus, éditorial resort luxe contemporain, magazine mode haut de gamme. Touches déco subtiles (1-2 max par photo) : sable sculpté par le vent, ombre de palmier. Jamais surchargé. Composition ultra épurée.

🔍 FRAMING — RING IS THE HERO : the ring dominates the composition (70-85% of frame width), tight macro / close-up like a luxury jewelry magazine hero shot. The bora-bora decor (pink-orange sand, palm shadow, warm late-afternoon light) is a SUPPORTING BACKDROP in the corners / negative space, never competing. The ring itself is NEVER modified — same shape, color, material, finish, gemstones.`,

  "tropical": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "TROPICAL" (luxe végétal sombre, Jacquemus / Saint Laurent tropical)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition (which subject is photographed, framing, ring centrality).

VISUAL DIRECTION :
- Setting : LUSH DARK TROPICAL VEGETATION — large satin-finished tropical leaves (monstera, philodendron, banana leaves) in deep forest green, dark olive, vegetal black. Atmosphere humid, organic, mysterious.
- Light : DRAMATIC DIRECTIONAL LIGHT (low-angle natural sunlight piercing through foliage), creating intense shadow zones + precise highlights on the leaves' satin surface and on the metal/stones of the ring.
- Shadows : deep, sharp, graphic — high contrast between sunlit zones and shadow zones of vegetation.
- Color palette : deep forest green, dark olive, vegetal black, with subtle GOLDEN warm reflections accenting the leaves' satin texture and the ring's metal. NO white/pastel backdrop.
- Mood : organic luxury, mysterious, silent, contemplative, sophisticated humidity, cinematic premium.
- Style references : Jacquemus tropical campaign, Saint Laurent jungle editorial, Zara Studio premium, Bottega vegetal high-end jewelry shoot.
- Decor accents (subtle, MAX 1-2 elements) : a curved leaf where the ring rests, a few water droplets on leaves or on the ring's stones, soft out-of-focus deeper vegetation in background — NEVER cluttered, focus stays on the jewelry.
- Composition : ultra-minimalist within the lush vegetal setting, lots of dark out-of-focus negative space (deep shadowy foliage), the ring is the bright focus point.
- Depth of field : SHORT (shallow DOF), dark blurred background of distant leaves, sharp foreground on the ring + immediate leaf it rests on.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : an ELEGANT woman in a sophisticated tropical setting, surrounded by large deep-green leaves and luxuriant natural textures. NATURAL LUMINOUS SATIN SKIN. Minimalist but modern fashion stylism : open-knit / crochet mesh, fluid natural fabric, modern silhouettes. Hair styled naturally. Warm contrasted light creates strong graphic shadows on the skin. Tones : forest green, olive, vegetal black, subtle gold light. Composition aesthetic and premium, Jacquemus/Saint Laurent tropical mood — mysterious, sensual, refined, NOT kitsch or excessive glamour.
- IF the action is a COFFRET / BOX shot : the white leatherette coffret sits on or near tropical leaves, warm contrasted directional light catches both the coffret and the surrounding deep vegetation, dark blurred jungle background.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace the neutral background with a large satin tropical leaf or layered dark green foliage, ring resting on a curved leaf or floating in front, dramatic directional natural light, water droplets optional on the leaf.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot. NOT a wide vegetal scene with a small ring inside.
- The tropical leaves / dark foliage are a SUPPORTING BACKDROP, occupying ONLY the corners, edges, and negative space around the ring.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit, with crisp golden highlights on metal and stones.
- For worn-ring shots : the ring + hand + portion of skin/fabric near the ring fill the frame ; the model's body, leaves, and tropical context are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight, macro precision on the ring details. Background vegetation is silent luxury organic, never competing.`,

  "terre-olive": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "TERRE OLIVE" (Jacquemus / Bottega editorial — silent luxury)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition (which subject is photographed, framing, ring centrality).

VISUAL DIRECTION :
- Setting : ultra-minimalist editorial backdrop — uniform textured surface in soft OLIVE / warm BEIGE SAND / IVORY tones (smooth plaster, raw paper, matte wall). Just one calm tone.
- Light : LATE AFTERNOON NATURAL DIRECTIONAL LIGHT from the side, warm and cinematographic, creating DEEP GRAPHIC SHADOWS on the surface.
- Shadows : signature Jacquemus / Bottega — bold hard-edged shadow shapes projected on the backdrop. High contrast between sunlit zones and shadow zones. Often a SOFT BLURRED LEAF SHADOW or vegetal silhouette in the background acts as the only decorative element.
- Color palette : olive doux / muted olive green, warm beige sand, ivory, warm cream, soft brown — with deep shadow zones. NO white seamless studio backdrop.
- Mood : SILENT LUXURY, calm, organic, modern, cinematic, contemplative, sophisticated minimalism.
- Style references : Jacquemus campaign, Bottega Veneta editorial, Khaite minimal, The Row silent luxury, high-end jewelry magazine.
- Decor accent (subtle, blurred, MAX ONE element per shot) : an out-of-focus leaf, a vegetal shadow on the wall, a smooth matte surface with relief, a water reflection, or just a play of light. NEVER cluttered.
- Composition : ULTRA MINIMALIST, lots of negative space, total focus on the jewelry.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : the model is ASIAN, with LONG SMOOTH BLACK HAIR, BARE SHOULDER VISIBLE, wearing a FLUID FLOWING WHITE COTTON BLOUSE (like a soft scarf — drape, soft movement, off-shoulder). NATURAL CLEAN MANICURE (subtle nude polish). Skin lit warmly by late afternoon directional light, deep graphic shadows on the body and blouse. Hand gracefully posed near the collarbone / shoulder, the RING is the absolute focus. Hair drapes naturally on one side.
- IF the action is a COFFRET / BOX shot : the coffret interior catches warm directional light, deep clean shadow on one side of the box, olive/beige tinted highlights. White leatherette interior is still white but warmly lit.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace the neutral background with a textured olive / beige / ivory wall surface, optional out-of-focus leaf shadow on the wall, ring resting on a matching matte surface in the foreground, warm directional side light, deep graphic shadow cast by the ring.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot. NOT a wide editorial portrait with a small ring inside.
- The olive/beige decor is a SUPPORTING BACKDROP, occupying ONLY the corners, edges, and negative space around the ring.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit.
- For worn-ring shots : the ring + hand + portion of skin/blouse near the ring fill the frame ; the model's body/shoulder/hair are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight on the ring. The decor is silent luxury minimalism, never competing.`,

  "terre-dombre": `

═══════════════════════════════════════════
🎨 GLOBAL THEME OVERRIDE — "TERRE D'OMBRE" (Jacquemus editorial)
═══════════════════════════════════════════

Apply this ambiance to the scene composed above. The theme REPLACES the default neutral lighting / background / palette, but PRESERVES the action's core composition (which subject is photographed, framing, ring centrality).

VISUAL DIRECTION :
- Setting : contemporary Mediterranean architecture — terracotta clay walls with textured warm-sand plaster, simple sculptural architectural volumes (corner / step / arch fragment / niche / raw clay ledge).
- Light : LATE AFTERNOON GOLDEN LIGHT entering from the SIDE (low-angle, ~25-40° from horizontal), warm and dramatic — like the last hour before sunset in a Provence / Greek island / Moroccan courtyard.
- Shadows : DEEP, GRAPHIC, BOLD shadows projected on surfaces (hard-edged shadow shapes — Jacquemus signature). HIGH CONTRAST between brightly-lit warm zones and deep shadow zones (some areas fully sunlit warm cream, others sinking into deep brown / black shadow).
- Color palette : terracotta, sand beige, burnt sienna, warm brown, ochre, copper — with DEEP BLACK / dark brown in shadows. NO white seamless studio backdrop, NO cool studio strobes.
- Mood : cinematic, editorial, elegant, mysterious, artisanal, raw yet refined.
- Style references : Jacquemus summer campaign, Loewe earth-tone editorial, Bottega Veneta minimalist sculptural, raw Mediterranean luxe.

ACTION-SPECIFIC ADAPTATIONS :
- IF the action is a WORN-RING shot (hand / body model) : the model has BRONZED/TAN skin, bare shoulder visible, golden side light grazes the shoulder / collarbone / arm, deep graphic shadows fall across the skin and body. Hair and pose remain editorial. Drape of natural linen / silk in warm tones if visible.
- IF the action is a COFFRET / BOX shot : the coffret interior catches warm golden side light, deep shadows on one side of the box, terracotta-tinted highlights instead of cool studio light. White leatherette interior is still white but warmly lit.
- IF the action is a STUDIO / OBJECT shot (Fond blanc, Fond anthracite, Amélioration, Lumière contraste, Style photographe Mood) : replace the neutral background with terracotta clay surface / sand plaster ledge, golden side light, bold shadow cast by the ring on the warm clay.
- The ring itself is NEVER modified — same shape, color, material, finish, gemstones.

🔍 FRAMING — RING IS THE HERO, BIG IN THE FRAME (CRITICAL) :
- The ring DOMINATES the composition — it fills 70-85% of the frame width.
- This is a TIGHT MACRO / CLOSE-UP shot, like a luxury jewelry magazine product hero shot. NOT a wide architectural shot with a small ring inside.
- The terracotta architecture / clay decor is a SUPPORTING BACKDROP, occupying ONLY the corners, edges, and negative space around the ring.
- The ring is the absolute focus subject — perfectly sharp, perfectly lit.
- For worn-ring shots : the ring + hand + portion of skin near the ring fill the frame ; the model's body/shoulder are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO.
- Camera : zoom in tight on the ring. If a wider context is shown, the ring still dominates ; never let the decor take over the frame.`,
};

async function appelGeminiMulti(imageDataUrls: string[], action: string, note?: string | null, formatOverride?: string | null, theme?: string | null, mode?: "objet" | "portee" | null, gender?: string | null, age?: string | null, qualite?: string | null): Promise<{ image?: string; error?: string }> {
  const isPortee = mode === "portee";
  const modelNote = isPortee ? buildModelProfileNote(gender, age) : "";
  let basePrompt: string;
  let themeOverlay = "";
  const porteePrompt = (isPortee && theme) ? selectPorteePrompt(theme, gender) : null;
  if (isPortee && porteePrompt) {
    basePrompt = porteePrompt + (PORTEE_STYLE_NOTES[action] || "") + modelNote;
  } else if (isPortee && action !== "bague-portee" && action !== "multi-formats" && PROMPTS["bague-portee"]) {
    basePrompt = PROMPTS["bague-portee"] + (PORTEE_STYLE_NOTES[action] || "") + modelNote;
  } else if (isPortee && action === "bague-portee" && PROMPTS["bague-portee"]) {
    basePrompt = PROMPTS["bague-portee"] + modelNote;
  } else {
    basePrompt = PROMPTS[action];
    const overlayRaw = (theme && THEME_OVERLAYS[theme]) ? THEME_OVERLAYS[theme] : "";
    themeOverlay = filterOverlayByMode(overlayRaw, "objet");
  }
  if (!basePrompt) return { error: `Action inconnue : ${action}` };
  // Clause multi-rings : précise à Gemini que toutes les bagues doivent être composées dans la même scène avec cohérence d'action
  const multiClause = (action !== "produit-multiple") ? `\n\n═══════════════════════════════════════════
🪞 MULTI-RING MODE (${imageDataUrls.length} rings attached as references)
═══════════════════════════════════════════
Apply the action above to ALL ${imageDataUrls.length} rings TOGETHER in a SINGLE scene :
- Show EXACTLY ${imageDataUrls.length} rings in the output (one per reference image attached, NEVER more, NEVER less).
- Each ring keeps its EXACT IDENTITY (shape, color, material, finish, gemstones, decoration) — pixel-identical to its reference.
- All rings share the SAME LIGHTING, SAME SURFACE / BACKGROUND, SAME ATMOSPHERE — consistent scene from action.
- Disperse the rings NATURALLY across the frame (breathing space, NOT grid alignment, NOT touching).
- Action-specific adaptations :
  • Fond Blanc / Fond Anthracite → all rings on the same uniform background, slight composition variety.
  • Coffret → all rings inside the same open Mood coffret (white leatherette interior), arranged elegantly together.
  • Bague Portée → multiple rings on the SAME ELEGANT HAND (different fingers), OR on the hands of the same model — one editorial close-up shot.
  • Style Photographe Mood → all rings in the same Léa narrative scene with consistent theme.
  • Amélioration / Lumière contraste → all rings cleaned and lit consistently in one scene.
  • Multi-formats → action does not apply to multi-ring mode (use single mode).` : "";
  let prompt = basePrompt + themeOverlay + multiClause;
  if (note && note.trim()) prompt += `\n\n=== INSTRUCTIONS SUPPLÉMENTAIRES DE L'UTILISATEUR ===\n${note.trim()}`;
  const aspectRatio = (formatOverride && /^\d+:\d+$/.test(formatOverride)) ? formatOverride : (RATIOS[action] || "1:1");

  const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];
  for (let i = 0; i < imageDataUrls.length; i++) {
    const m = imageDataUrls[i].match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return { error: `Image ${i + 1} invalide (doit être data:image/...;base64,...)` };
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: prompt });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: (qualite === "final" ? "2K" : "1K") },
        },
      }),
    });
    const respText = await r.text();
    let respData: { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }>; promptFeedback?: { blockReason?: string }; error?: { message?: string } };
    try { respData = JSON.parse(respText); }
    catch { return { error: `Réponse Gemini non-JSON (HTTP ${r.status}): ${respText.slice(0, 200)}` }; }
    if (!r.ok) {
      const msg = respData?.error?.message || JSON.stringify(respData).slice(0, 300);
      return { error: `Gemini ${r.status}: ${msg}` };
    }
    const candidate = respData?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return { error: `Gemini a refusé (finishReason: ${candidate.finishReason}).` };
    }
    if (respData?.promptFeedback?.blockReason) {
      return { error: `Bloqué par les filtres (${respData.promptFeedback.blockReason}).` };
    }
    const partsOut = (candidate?.content?.parts || []) as Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
    const imagePart = partsOut.find(p => p.inlineData?.mimeType?.startsWith?.("image/"));
    if (!imagePart?.inlineData?.data) {
      const textPart = partsOut.find(p => p.text);
      return { error: textPart?.text ? `Gemini a répondu par texte : « ${textPart.text.slice(0, 150)} »` : "Pas d'image en sortie." };
    }
    return { image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
}

// Prompts portée COMPLETS et PRÉCIS pour chaque thème (les prompts FR fournis par Amila, intégralement).
// En mode portée + thème actif, ces prompts REMPLACENT le base prompt bague-portee générique
// pour éviter tout mélange avec les directives objet/coffret du thème.
// Prompts portée VERSION HOMME (utilisée quand gender = "homme" et le thème a une variante homme dédiée).
// Si gender = "femme" ou "auto" ou que le thème n'a pas de variante homme, on retombe sur THEME_PORTEE_PROMPTS (version féminine par défaut).
export const THEME_PORTEE_PROMPTS_HOMME: Record<string, string> = {
  "in-the-mood-for": `🚨 PHOTO EDITORIALE BAGUE PORTÉE HOMME — THÈME IN THE MOOD FOR (soft luxury cosy masculin)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end lifestyle WORN-RING photograph in soft luxury masculine visual language :

Photo LIFESTYLE ÉDITORIALE MODERNE. HOMME BRONZÉ aux mains soignées (ongles courts, propres, NATURELS — PAS DE MANUCURE FRENCH, peau saine légèrement bronzée). POINGS TENDUS VERS L'OBJECTIF devant le visage pour le CACHER PARTIELLEMENT.

Focus ULTRA NET sur les mains au PREMIER PLAN. Visage et arrière-plan FORTEMENT FLOUS. Profondeur de champ très faible avec bokeh DOUX ET CRÉMEUX. Lumière naturelle DIFFUSE ET CHALEUREUSE. Ambiance COSY ET PREMIUM.

Vêtements DOUX BEIGE NUDE (sweat oversize beige, lin clair, knit crème — soft warm neutrals). Esthétique MINIMALISTE et raffinée. Pose CONFIANTE ET MODERNE. Style Pinterest LUXE. Rendu photoréaliste. Ombres délicates. Cadrage immersif centré sur les mains. Objectif portrait 85mm. Ambiance douce et tendance.

🔍 FRAMING : focus principal sur les mains et la bague (ring ~70-85% of frame width), visage flou en arrière-plan, the RING REMAINS THE HERO, perfectly sharp.`,

  "beton": `🚨 PHOTO EDITORIALE BAGUE PORTÉE HOMME — THÈME BÉTON (luxe urbain minéral)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in masculine urban moody visual language :

Editorial masculin minimaliste. LUMIÈRE NATURELLE TAMISÉE, ambiance MOODY ET ÉLÉGANTE. HOMME élégant portant des vêtements OVERSIZE TEXTURÉS dans des TONS TERREUX ET NEUTRES (taupe, beige sombre, gris ardoise, noir mat — pull en maille épaisse, manteau structuré, ou chemise lin froissée).

Cadrage FOCUS MAINS ET TORSE (pas le visage en gros plan, juste mains + manche + buste hors-focus). Esthétique luxe contemporaine, style urbain raffiné. Rendu cinématographique photoréaliste. Fond ÉPURÉ SOMBRE (anthracite, béton, mur minéral). Attitude calme et confiante.

🔍 FRAMING : the ring + hand + portion of fabric sleeve / wrist near the ring fill the frame (ring ~70-85% of frame width). The man's body / oversize textured clothing are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,
};

export const THEME_PORTEE_PROMPTS: Record<string, string> = {
  "lifestyle": `🚨 PHOTO LIFESTYLE BAGUE PORTÉE — THÈME LIFESTYLE (voyage spontané authentique)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a lifestyle WORN-RING photograph in authentic spontaneous visual language :

Photo LIFESTYLE SPONTANÉE prise à la main. MAIN TENDUE VERS LE PAYSAGE ou l'ENVIRONNEMENT (la main au premier plan avec le paysage vivant en arrière-plan — terrasse vue mer, café, montagne, rue urbaine, plage, intérieur cozy, selon ce qui fait sens).

Focus NATUREL sur la main au PREMIER PLAN avec arrière-plan VIVANT ET IMMERSIF. Ambiance authentique "DAILY LIFE". Lumière NATURELLE RÉELLE (sun, golden hour, overcast — selon contexte). Style photo SOUVENIR PREMIUM, esthétique Pinterest lifestyle.

Cadrage SIMPLE ET SPONTANÉ comme une photo prise sur le moment avec smartphone (mais qualité premium). Profondeur légère naturelle. Environnement légèrement flou mais RECONNAISSABLE. Rendu photoréaliste. Ambiance VOYAGE ET MOMENTS DE VIE. Composition décontractée et organique. Lumière extérieure réaliste. Style NON STUDIO. Sensation de vrai instant capturé.

🔍 FRAMING : the ring + hand + portion of skin near the ring fill the frame (ring ~70-85% of frame width). The environment (paysage, café, rue, intérieur) is supporting, soft-focused but recognizable — the RING REMAINS THE HERO, perfectly sharp.`,

  "in-the-mood-for": `🚨 PHOTO EDITORIALE BAGUE PORTÉE FEMME — THÈME IN THE MOOD FOR (soft luxury cosy féminin)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end lifestyle WORN-RING photograph in soft luxury feminine visual language :

Photo LIFESTYLE ÉDITORIALE MODERNE. BELLE FEMME BRONZÉE. ONGLES MANUCURÉS forme AMANDE avec FRENCH ÉLÉGANTE (nude pink base + fine white tip). Petit TATOUAGE DISCRET au doigt (tiny minimal tattoo, very subtle).

POINGS TENDUS VERS L'OBJECTIF devant le visage pour le CACHER PARTIELLEMENT. Focus ULTRA NET sur les mains au PREMIER PLAN, visage et arrière-plan FORTEMENT FLOUS. Profondeur de champ très faible avec bokeh DOUX ET CRÉMEUX.

Lumière naturelle DIFFUSE ET CHALEUREUSE. Ambiance COSY ET PREMIUM. Vêtements DOUX BEIGE NUDE (knit cream, lin clair, soft cashmere beige). Esthétique MINIMALISTE ET FÉMININE. Pose CONFIANTE ET MODERNE. Style Pinterest LUXE. Rendu photoréaliste. Ombres délicates. Cadrage immersif centré sur les mains. Objectif portrait 85mm. Ambiance douce et tendance.

🔍 FRAMING : focus principal sur les mains et la bague (ring ~70-85% of frame width), visage flou en arrière-plan, the RING REMAINS THE HERO, perfectly sharp, with French manicure visible on the fingers.`,

  "pastel": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME PASTEL (streetwear hoodie pastel premium)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end lifestyle WORN-RING photograph in modern streetwear visual language :

Photo LIFESTYLE URBAINE MODERNE. CADRAGE DYNAMIQUE EN PERSPECTIVE avec les POINGS TENDUS VERS L'OBJECTIF (modèle tend les poings/mains en direction de la caméra, vue immersive forced-perspective).

Focus NET sur les mains au PREMIER PLAN, arrière-plan volontairement FLOU. Profondeur de champ très faible avec BOKEH DOUX. Attitude CONFIANTE ET PLAYFUL. Lumière naturelle douce légèrement cinématographique.

Ambiance STREETWEAR MINIMALISTE. HOODIE OVERSIZE PASTEL (sweat à capuche large, couleur pastel douce — rose poudré, lavande, bleu pâle, mint, beige cream, jaune doux — coordonné à la couleur de la bague centrale).

Esthétique MODERNE ET TENDANCE, style éditorial Pinterest premium. Composition immersive avec effet de profondeur. Rendu photoréaliste. Ombres douces. Ambiance JEUNE ET COOL.

🔍 FRAMING : focus principal sur les mains et les détails au premier plan (ring ~70-85% of frame width), arrière-plan flou artistique (modèle, hoodie pastel partiellement out-of-focus) — the RING REMAINS THE HERO, perfectly sharp.`,

  "beton": `🚨 PHOTO EDITORIALE BAGUE PORTÉE FEMME — THÈME BÉTON (luxe urbain chic)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in feminine urban chic visual language :

Editorial fashion lifestyle. FEMME ÉLÉGANTE style URBAIN CHIC. TOP NOIR MINIMALISTE (débardeur, top satin noir, ou tee-shirt structuré noir mat). Lumière DOUCE ET SOMBRE, ambiance LUXE MODERNE. Accumulation de BIJOUX FINS ET AUDACIEUX possible (mais discrète — la bague Mood reste hero).

Pose naturelle (miroir, ou cadrage rapproché main / poignet près du visage). Esthétique PINTEREST PREMIUM, rendu cinématographique photoréaliste. FOND DISCRET ET FLOU (anthracite, béton, intérieur sombre minimaliste). Style sophistiqué et tendance.

🔍 FRAMING : the ring + hand + portion of black top / skin near the ring fill the frame (ring ~70-85% of frame width). The woman's body / dark background are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,

  "zanzibar": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME ZANZIBAR (luxe minimaliste océan / coquillage)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in oceanic minimalist visual language :

Photo lifestyle minimaliste et élégante, LUMIÈRE NATURELLE DOUCE, femme portant une CHEMISE BLANCHE OVERSIZE (chemise blanche très ample, en coton ou popeline souple, légèrement froissée naturellement). Ambiance éditoriale moderne. CADRAGE RAPPROCHÉ SUR LES MAINS ET POIGNETS — main posée naturellement, poignet visible, détendu.

Pose naturelle et détendue. Fond CLAIR ET ÉPURÉ (white seamless ou beige très clair). PROFONDEUR DE CHAMP LÉGÈRE (background très doucement flou). Tons chauds et lumineux. Style premium, esthétique simple et raffinée. Rendu photoréaliste. TRÈS PEU D'ACCESSOIRES (no concurrent jewelry on other fingers). Ambiance douce et féminine.

🔍 FRAMING : the ring + hand + portion of wrist + portion of white shirt sleeve near the ring fill the frame (ring ~70-85% of frame width). The woman's body / oversized shirt are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,

  "terre-dombre": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME TERRE D'OMBRE (Jacquemus)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in the visual language of a Jacquemus campaign :

Femme à la peau bronzée, épaule dénudée. Lumière dorée de fin de journée entrant latéralement, ombres profondes et graphiques projetées sur les surfaces et sur la peau. Ambiance cinématographique et éditoriale haut de gamme, esthétique mode type Jacquemus ou campagne de luxe. Contraste fort entre lumière chaude et obscurité, atmosphère élégante, mystérieuse et artisanale. Tons terracotta, beige, brun chaud et noir profond. Lumière dramatique, composition épurée et sophistiquée.

🔍 FRAMING : the ring + hand + portion of skin near the ring fill the frame (ring ~70-85% of frame width). The model's body, shoulder, decor are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO, perfectly sharp. Magazine print quality.`,

  "terre-olive": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME TERRE OLIVE (Bottega / Khaite silent luxury)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in silent luxury visual language :

Femme asiatique, longs cheveux noirs lisses. Photographie éditoriale minimaliste de bijoux de luxe, ambiance très épurée et sophistiquée. Lumière naturelle directionnelle de fin de journée créant des ombres profondes et graphiques. Esthétique inspirée de Jacquemus, Bottega Veneta et campagnes joaillerie haut de gamme. Composition ultra minimaliste avec beaucoup d'espace vide, focus total sur le bijou. Atmosphère calme, organique, moderne et luxueuse. Rendu photo éditorial premium, ultra réaliste, lumière chaude et cinématographique, profondeur de champ douce, détails précieux, esthétique luxe silencieux et contemporain.

TENUE : blouse très fluide (comme un foulard) avec mouvement en coton blanc. Épaule dénudée. MANUCURE : naturel très soignée.

🔍 FRAMING : ZOOM sur la bague — the ring + hand + portion of skin/blouse near the ring fill the frame (ring ~70-85% of frame width). The model's body, hair, blouse are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO, perfectly sharp. Magazine print quality.`,

  "tropical": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME TROPICAL (Jacquemus / Saint Laurent jungle)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in tropical luxe visual language :

Photographie mode éditoriale haut de gamme inspirée de campagnes beauté et luxe contemporaines. Femme élégante dans un univers tropical sophistiqué, entourée de grandes feuilles vert profondes et textures naturelles luxuriantes. Ambiance cinématographique, organique et artistique, lumière chaude et contrastée créant de fortes ombres graphiques sur la peau et le décor.

Beauté naturelle, PEAU LUMINEUSE ET SATINÉE. Stylisme minimaliste mais mode : maille ajourée, tissu fluide, matières naturelles, silhouettes élégantes et modernes. Tons vert forêt, olive, noir végétal et lumière dorée subtile.

Composition très esthétique et premium, inspirée de campagnes Jacquemus, Zara Studio, Saint Laurent ou photographie mode tropicale luxe. Atmosphère mystérieuse, sensuelle et raffinée, SANS effet kitsch ni glamour excessif. Rendu ultra réaliste, éditorial, sophistiqué et artistique.

🔍 FRAMING : focus et zoom sur la bague — the ring + hand + portion of skin/fabric near the ring fill the frame (ring ~70-85% of frame width). The model's body, leaves, tropical decor are supporting, partially out of frame, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,

  "riviera": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME RIVIERA (Cartier / Jacquemus resort luxe)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in Mediterranean resort luxe visual language :

Photographie éditoriale estivale haut de gamme inspirée des campagnes resort de luxe et beauté méditerranéenne. Femme élégante DANS UNE PISCINE en pierre claire, peau bronzée satinée par le soleil, maillot minimaliste chic. Eau turquoise cristalline créant des reflets mouvants et lumineux sur la peau et les surfaces minérales.

PRISE DE VUE EN PLONGÉE, composition épurée et sophistiquée, ambiance calme et sensuelle. Lumière naturelle forte de milieu de journée, ombres nettes et graphiques, esthétique luxe silencieux. Palette douce et solaire : beige pierre chaude, turquoise pâle, peau dorée et blanc crème.

Filtre éditorial premium légèrement chaud et désaturé, contraste doux, grain subtil type photographie argentique luxe, rendu lumineux et cinématographique inspiré de Jacquemus, campaigns resortwear et magazines mode haut de gamme.

Atmosphère minimaliste, méditerranéenne et exclusive, ultra réaliste, élégante et moderne.

🔍 FRAMING : the ring + hand + portion of bronzed skin near the ring fill the frame (ring ~70-85% of frame width). The woman's body, pool, swimsuit are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,

  "bora-bora": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME BORA BORA (resort luxe, lagon sable rose orangé)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph with this exact Mood ambiance :

Photographie éditoriale estivale haut de gamme inspirée des campagnes resort de luxe et beauté méditerranéenne. Femme élégante DANS UNE PISCINE en pierre claire, piscine fond ocre, peau bronzée satinée par le soleil, maillot minimaliste chic rose clair ou brun. Eau créant des reflets mouvants et lumineux sur la peau et les surfaces minérales. Prise de vue en plongée, composition épurée et sophistiquée, ambiance calme et sensuelle. Lumière chaude naturelle forte de fin de journée, ombres nettes et graphiques, esthétique luxe silencieux. Palette douce et solaire : beige pierre chaude, rose pâle, peau dorée et beige crème. Filtre éditorial premium légèrement chaud et désaturé, contraste doux, grain subtil type photographie argentique luxe, rendu lumineux et cinématographique inspiré de Jacquemus, campaigns resortwear et magazines mode haut de gamme. Atmosphère minimaliste, méditerranéenne et exclusive, ultra réaliste, élégante et moderne. Pose naturelle, peau bronzée légèrement mouillée, manucure rose clair. Zoom et focus sur la bague. Ombre de fleur de frangipanier.

🔍 FRAMING : the ring + hand + portion of bronzed skin near the ring fill the frame (ring ~70-85% of frame width). The woman's body, pool, swimsuit are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp.`,

  "sakura": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME SAKURA (Jacquemus poésie cerisier)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in poetic spring luxury visual language :

Photographie macro éditoriale de luxe d'une bague portée sur une main féminine élégante, FOCUS TRÈS NET ET RAPPROCHÉ SUR LA BAGUE. Main délicatement posée près d'une épaule dénudée, peau légèrement bronzée et lumineuse. Robe fluide ROSE CLAIR en tissu léger et aérien, mouvement subtil du textile dans une ambiance printanière douce et sophistiquée.

Lumière naturelle du matin, chaude et délicate, créant de FINES OMBRES DE BRANCHES DE SAKURA sur la peau et le décor. Palette pastel raffinée : rose poudré, beige chaud, blanc crème et reflets dorés subtils.

Composition minimaliste et haut de gamme inspirée de Jacquemus et des campagnes joaillerie luxe contemporaines. Profondeur de champ courte, arrière-plan flou et lumineux, esthétique propre, élégante et moderne. Atmosphère romantique, fraîche et premium, rendu ultra réaliste et cinématographique.

🔍 FRAMING : zoom serré sur la bague (ring ~70-85% of frame width). The model's hand, shoulder, dress are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp, with delicate sakura branch shadows on skin nearby.`,

  "black-joaillerie": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME BLACK JOAILLERIE (Cartier / Dior Haute Joaillerie / Vogue)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in haute couture haute joaillerie visual language :

Photographie éditoriale haute couture portée, ambiance très luxueuse, dramatique et sophistiquée. Femme élégante photographiée dans un STUDIO SOMBRE ET MINIMALISTE, peau profondément lumineuse sculptée par une LUMIÈRE DIRECTIONNELLE INTENSE. Jeux d'ombres cinématographiques créant un contraste fort entre obscurité et lumière.

Poses statuesques et artistiques inspirées des campagnes haute joaillerie et couture contemporaines. Styling minimaliste NOIR ou monochrome, ÉPAULES DÉNUDÉES, tissus structurés ou satinés très sobres.

Fond NOIR PROFOND ou gris anthracite. Atmosphère mystérieuse, puissante et intemporelle. Esthétique inspirée de campagnes Cartier, Dior Haute Joaillerie, Vogue et photographie mode luxe contemporaine.

Rendu ultra réaliste, peau satinée, lumière sculpturale, profondeur de champ douce, élégance silencieuse et artistique, SANS surcharge visuelle ni glamour excessif.

🔍 FRAMING : focus et zoom sur la bague (ring ~70-85% of frame width). The model's body, shoulders, dark studio background are supporting, partially in shadow — the RING REMAINS THE HERO, perfectly sharp, with crisp sculptural highlights on metal and stones.`,

  "pur-white": `🚨 PHOTO EDITORIALE BAGUE PORTÉE — THÈME PUR WHITE JOAILLERIE (Swarovski / Dior couture)

The attached image is THIS EXACT Mood Collection ring — preserve it pixel-identically (same shape, color, material, finish, gemstones, decoration). The ring is the absolute hero of the photo.

Compose a high-end editorial WORN-RING photograph in crystalline couture visual language :

Photographie éditoriale mode ULTRA HAUT DE GAMME dans une ambiance minimaliste, aérienne et sculpturale. Bague portée. Femme élégante vêtue de TISSUS BLANCS FLUIDES ET TEXTURÉS : plissés couture, mousseline légère, satin mat et organza vaporeux. Inspirées de la haute couture contemporaine et des campagnes Jacquemus, Dior et Vogue.

Palette monochrome CRÈME, IVOIRE, BLANC CASSÉ ET BEIGE TRÈS CLAIR. Lumière naturelle douce et diffuse, presque solaire, créant des ombres délicates et des contrastes subtils sur les tissus et la peau. Atmosphère calme, pure et luxueuse.

Très peu d'éléments dans l'image. FOCUS SUR LA BAGUE ET ZOOM SUR LA BAGUE. Chapeaux oversize sculpturaux, voiles légers flottants, compositions épurées et artistiques.

Esthétique cinématographique premium, moderne et intemporelle. Arrière-plan minimal blanc ou sable clair, profondeur de champ douce, rendu ultra réaliste et raffiné. Sensation de luxe discret, sophistication naturelle et poésie contemporaine.

🔍 FRAMING : zoom serré sur la bague (ring ~70-85% of frame width). The model's body, white fabrics, hat are supporting, soft-focused — the RING REMAINS THE HERO, perfectly sharp, with delicate prismatic highlights.`,
};

// Override genre + âge du modèle (mode portée seulement) — injecté en suffixe pour OVERRIDER toute mention contraire du thème
const GENDER_LABELS: Record<string, string> = {
  "femme": "FEMME",
  "homme": "HOMME",
};
const AGE_LABELS: Record<string, string> = {
  "18-30": "18-30 ans (jeune adulte)",
  "30-45": "30-45 ans (jeune)",
  "45-60": "45-60 ans (mature)",
  "60+": "60+ ans (senior)",
};
function buildModelProfileNote(gender?: string | null, age?: string | null): string {
  const hasGender = gender && gender !== "auto" && GENDER_LABELS[gender];
  const hasAge = age && age !== "auto" && AGE_LABELS[age];
  if (!hasGender && !hasAge) return "";
  const parts: string[] = [];
  if (hasGender) parts.push(`Genre du modèle : **${GENDER_LABELS[gender!]}** — override toute mention contraire dans les directives ci-dessus (peu importe ce qui est écrit sur le genre dans le prompt thème, le modèle est ${GENDER_LABELS[gender!]}).`);
  if (hasAge) parts.push(`Tranche d'âge du modèle : **${AGE_LABELS[age!]}** — le modèle doit clairement apparaître dans cette tranche d'âge (peau, cheveux, allure correspondants).`);
  return `

═══════════════════════════════════════════
🚨 PROFIL MODÈLE — OVERRIDE UTILISATEUR (priorité absolue)
═══════════════════════════════════════════

${parts.join("\n\n")}

Ces caractéristiques OVERRIDENT toute mention contraire de genre / âge / origine ethnique dans les directives ci-dessus. Tout le reste du prompt (lumière, décor, tissu, ambiance, palette) reste valide à 100%.`;
}

// MOOD_RING_WIDTH_NOTE désactivée le 27 mai 2026 (S119) : les contraintes anatomiques strictes
// (largeurs 9/11/13mm, 1/3 phalange, pas plus large que doigt, ne pas enlarger/thicken/bulk up)
// rendaient le prompt fade et moins naturel. Retiré pour revenir au rendu "luxe magazine" d'origine.
// Constante conservée en commentaire au cas où il faudrait revenir.
// const MOOD_RING_WIDTH_NOTE = `...`;

// Notes de décor à ajouter au prompt portée selon le style cliqué (mode portée)
const PORTEE_STYLE_NOTES: Record<string, string> = {
  "fond-blanc": "\n\n[BACKGROUND VARIATION — STYLE FOND BLANC] : behind the model + ring, use a clean pure white seamless background, minimalist and neutral, soft daylight on the composition.",
  "fond-anthracite": "\n\n[BACKGROUND VARIATION — STYLE FOND ANTHRACITE] : behind the model + ring, use a deep anthracite / dark gray seamless background, soft directional light from one side, sophisticated cinematic mood.",
  "amelioration": "\n\n[QUALITY VARIATION — STYLE AMÉLIORATION] : ultra-clean magazine retouching pass — perfect satin skin (no blemishes), no fabric parasites, ring mirror-clean, gemstones brilliant, professional editorial finish.",
  "lumiere-contraste": "\n\n[LIGHTING VARIATION — STYLE LUMIÈRE CONTRASTE] : dramatic high-contrast lighting on the worn-ring composition — single strong directional light, deep cast shadows on skin and fabric, crisp highlights on metal and stones.",
  "style-mood": "\n\n[DECOR VARIATION — STYLE PHOTOGRAPHE MOOD (Léa)] : interpret the active theme overlay as the narrative background behind the model — narrative editorial scene with thematic decor, model + ring as hero of the scene.",
  "coffret": "\n\n[COFFRET VARIATION] : the worn ring is on the model's hand, with an open Mood coffret (white leatherette) visible in the soft-focus background or held in the second hand as accent — not the main subject.",
  "bague-portee": "",
};

// Filtre l'overlay thème selon le mode (objet ou portee) — supprime les sections non pertinentes
// pour servir à Gemini un prompt cohérent qui ne mélange pas les directives portée et objet/coffret
function filterOverlayByMode(overlay: string, mode: "objet" | "portee"): string {
  if (!overlay) return "";
  if (mode === "portee") {
    return overlay
      .replace(/- IF the action is a COFFRET[\s\S]*?(?=\n- IF|\n🔍|$)/g, "")
      .replace(/- IF the action is a STUDIO[\s\S]*?(?=\n- IF|\n🔍|$)/g, "");
  }
  return overlay.replace(/- IF the action is a WORN-RING[\s\S]*?(?=\n- IF|\n🔍|$)/g, "");
}

// Sélecteur du prompt portée selon le genre choisi par l'utilisateur
function selectPorteePrompt(theme: string, gender?: string | null): string | null {
  if (gender === "homme" && THEME_PORTEE_PROMPTS_HOMME[theme]) return THEME_PORTEE_PROMPTS_HOMME[theme];
  return THEME_PORTEE_PROMPTS[theme] || null;
}

async function appelGemini(imageDataUrl: string, action: string, note?: string | null, formatOverride?: string | null, theme?: string | null, mode?: "objet" | "portee" | null, gender?: string | null, age?: string | null, qualite?: string | null): Promise<{ image?: string; error?: string }> {
  const isPortee = mode === "portee";
  const modelNote = isPortee ? buildModelProfileNote(gender, age) : "";
  let basePrompt: string;
  let themeOverlay = "";
  const porteePrompt = (isPortee && theme) ? selectPorteePrompt(theme, gender) : null;
  if (isPortee && porteePrompt) {
    basePrompt = porteePrompt + (PORTEE_STYLE_NOTES[action] || "") + modelNote;
  } else if (isPortee && action !== "bague-portee" && action !== "multi-formats" && PROMPTS["bague-portee"]) {
    basePrompt = PROMPTS["bague-portee"] + (PORTEE_STYLE_NOTES[action] || "") + modelNote;
  } else if (isPortee && action === "bague-portee" && PROMPTS["bague-portee"]) {
    basePrompt = PROMPTS["bague-portee"] + modelNote;
  } else {
    basePrompt = PROMPTS[action];
    const overlayRaw = (theme && THEME_OVERLAYS[theme]) ? THEME_OVERLAYS[theme] : "";
    themeOverlay = filterOverlayByMode(overlayRaw, "objet");
  }
  if (!basePrompt) return { error: `Action inconnue : ${action}` };
  let prompt = basePrompt + themeOverlay;
  if (note && note.trim()) {
    prompt += `\n\n=== INSTRUCTIONS SUPPLÉMENTAIRES DE L'UTILISATEUR (à respecter en priorité) ===\n${note.trim()}`;
  }
  const aspectRatio = (formatOverride && /^\d+:\d+$/.test(formatOverride)) ? formatOverride : (RATIOS[action] || "1:1");

  // Extraire mimeType et data depuis dataUrl
  const m = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { error: "Image invalide (doit être data:image/...;base64,...)" };
  const mimeType = m[1];
  const data = m[2];

  // Ordre : bague source EN PREMIER (IMAGE 1 = identité préservée),
  // puis référence d'angle si présente (IMAGE 2 = angle uniquement)
  const refPart = loadActionReference(action);
  const parts = refPart
    ? [{ inlineData: { mimeType, data } }, refPart, { text: prompt }]
    : [{ inlineData: { mimeType, data } }, { text: prompt }];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: (qualite === "final" ? "2K" : "1K") },
        },
      }),
    });
    const respText = await r.text();
    let respData: { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }>; promptFeedback?: { blockReason?: string }; error?: { message?: string } };
    try {
      respData = JSON.parse(respText);
    } catch {
      return { error: `Réponse Gemini non-JSON (HTTP ${r.status}): ${respText.slice(0, 200)}` };
    }
    if (!r.ok) {
      const msg = respData?.error?.message || JSON.stringify(respData).slice(0, 300);
      return { error: `Gemini ${r.status}: ${msg}` };
    }
    const candidate = respData?.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      return { error: `Gemini a refusé (finishReason: ${candidate.finishReason}). Essaye avec une autre photo ou une action différente.` };
    }
    if (respData?.promptFeedback?.blockReason) {
      return { error: `Image bloquée par les filtres Gemini (${respData.promptFeedback.blockReason}). Essaye avec une autre photo.` };
    }
    const partsOut = (candidate?.content?.parts || []) as Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }>;
    const imagePart = partsOut.find(p => p.inlineData?.mimeType?.startsWith?.("image/"));
    if (!imagePart?.inlineData?.data) {
      // Si Gemini a renvoyé du texte au lieu d'une image
      const textPart = partsOut.find(p => p.text);
      const msg = textPart?.text ? `Gemini a répondu par texte au lieu d'image : « ${textPart.text.slice(0, 150)} »` : "Pas d'image en sortie. La requête a peut-être été bloquée ou refusée.";
      return { error: msg };
    }
    return { image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
}

export async function POST(req: Request) {
  if (!GEMINI_KEY)
    return NextResponse.json({ error: "GEMINI_API_KEY manquante côté serveur" }, { status: 500 });

  let body: { image?: string; images?: string[]; action?: string; note?: string | null; format?: string | null; theme?: string | null; mode?: "objet" | "portee" | null; gender?: string | null; age?: string | null; qualite?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const { image, images, action, note, format, theme, mode, gender, age, qualite } = body;
  if (!action) {
    return NextResponse.json({ error: "Champ requis : action" }, { status: 400 });
  }

  // Cas multi-bagues : N>=2 images → toutes les actions standards s'appliquent à la composition multi
  const hasMulti = images && Array.isArray(images) && images.length >= 2;
  if (hasMulti) {
    if (images.length > 6) {
      return NextResponse.json({ error: "Maximum 6 bagues en mode multi" }, { status: 400 });
    }
    if (action === "multi-formats") {
      return NextResponse.json({ error: "Multi-formats ne fonctionne pas en mode multi-bagues — passe d'abord en mode 1 bague" }, { status: 400 });
    }
    const res = await appelGeminiMulti(images, action, note, format, theme, mode, gender, age, qualite);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
    await recordGeminiImages(1, qualite);
    return NextResponse.json({ image: res.image });
  }

  if (!image) {
    return NextResponse.json({ error: "Champ requis : image (dataUrl)" }, { status: 400 });
  }

  // Cas spécial : multi-formats = 4 appels parallèles (le format global est ignoré, on génère les 4)
  if (action === "multi-formats") {
    const ratios = ["multi-1-1", "multi-4-5", "multi-9-16", "multi-16-9"];
    const labels: Record<string, string> = {
      "multi-1-1": "Carré 1:1 (Insta post)",
      "multi-4-5": "Portrait 4:5 (Insta feed)",
      "multi-9-16": "Vertical 9:16 (Story/Reel)",
      "multi-16-9": "Paysage 16:9 (FB cover)",
    };
    const results = await Promise.all(ratios.map(r => appelGemini(image, r, note, null, theme, mode, gender, age, qualite).then(res => ({ ...res, ratio: r, label: labels[r] }))));
    const okCount = results.filter(r => r.image && !r.error).length;
    await recordGeminiImages(okCount, qualite);
    return NextResponse.json({ resultats: results });
  }

  // Cas simple : 1 appel — le format choisi par l'utilisateur override le ratio par défaut de l'action
  const res = await appelGemini(image, action, note, format, theme, mode, gender, age, qualite);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  await recordGeminiImages(1, qualite);
  return NextResponse.json({ image: res.image });
}
