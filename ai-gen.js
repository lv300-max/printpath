/* ============================================================
   PrintPath — AI Design Generator
   Prompt → design images → Sticker Lab or Design Lab
   Vanilla JS · No frameworks · No dependencies
   ============================================================ */

'use strict';

/* ====================================================
   CONFIG
   ==================================================== */
const AI_GEN_CONFIG = {
  // localStorage key for saving selected designs
  savedDesignsKey: 'td-ai-designs',
  savedDesignsMax: 20,

  // Min resolution required for print (matches STICKER_CONFIG.minDpi)
  minDpi: 300,

  // gpt-image-1 outputs 1024×1024 px at 96 ppi native.
  // After the upscale step the client reports 192+ DPI.
  apiOutputDpi: 96,
  apiOutputPx:  1024,

  // Backend endpoints — relative paths work on Netlify + locally via netlify dev
  serverUrl:        '',
  generatePath:     '/generate-image',
  upscalePath:      '/upscale-image',       // logical shim (fallback)
  realUpscalePath:  '/real-upscale',        // Replicate Real-ESRGAN (4× real pixels)

  // Print size presets — inches × 300 = required pixels
  printSizes: [
    { label: '3 × 3"  — sticker',            inches: 3  },
    { label: '4 × 4"  — small chest logo',    inches: 4  },
    { label: '5 × 5"  — standard chest',      inches: 5  },
    { label: '8 × 8"  — large front print',   inches: 8  },
    { label: '10 × 10" — full front',         inches: 10 },
    { label: '12 × 12" — oversized',          inches: 12 },
  ],
  defaultSizeIdx: 1,  // 4" default — good for gpt-image-1's 1024px output

  // Real upscale endpoint (Replicate Real-ESRGAN via server)
  realUpscalePath: '/real-upscale',
};

/* ====================================================
   QA MODE — controls which rule set ppQaInspect() uses
   ====================================================
   'sticker' — strict:  transparent background, sharp edges, isolated subject
   'shirt'   — medium:  more tolerance for filled backgrounds & composition
   'logo'    — very strict: minimal blobs, tight centering, clean transparency

   Persisted in localStorage under 'pp-qa-mode' so the user's
   last choice survives page reloads.
   ==================================================== */

const QA_MODE_KEY     = 'pp-qa-mode';
const QA_MODE_DEFAULT = 'sticker';
const QA_MODE_OPTIONS = ['sticker', 'shirt', 'logo'];

// Active mode — read from localStorage on load, falls back to default
let QA_MODE = (() => {
  try {
    const saved = localStorage.getItem(QA_MODE_KEY);
    return QA_MODE_OPTIONS.includes(saved) ? saved : QA_MODE_DEFAULT;
  } catch (_) { return QA_MODE_DEFAULT; }
})();

/** Set QA mode, persist it, and update any open picker UI */
function ppSetQaMode(mode) {
  if (!QA_MODE_OPTIONS.includes(mode)) return;
  QA_MODE = mode;
  try { localStorage.setItem(QA_MODE_KEY, mode); } catch (_) {}
  // Sync the pickers (action bar + top selector)
  const picker = document.getElementById('ai-qa-mode-picker');
  if (picker && picker.value !== mode) picker.value = mode;
  const pickerTop = document.getElementById('ai-qa-mode-top');
  if (pickerTop && pickerTop.value !== mode) pickerTop.value = mode;
  // If a design is already selected, clear its QA cache and re-inspect
  if (aiGenState && aiGenState.selected) {
    delete aiGenState.selected._qa;
    const idx = (aiGenState.results || []).findIndex(r => r.url === aiGenState.selected.url);
    if (idx !== -1) delete aiGenState.results[idx]._qa;
    ppQaInspect(aiGenState.selected, aiGenState.lastPrompt || '').then(qa => {
      aiGenState.selected._qa = qa;
      if (idx !== -1) aiGenState.results[idx]._qa = qa;
      aiGenRenderResults();
      aiGenShowActionBar(aiGenState.selected);
    }).catch(() => {});
  }
}

const QA_CONFIG = {
  sticker: {
    label:            'Sticker QA',
    transparencyMin:  0.25,   // ≥ 25% transparent pixels required
    transparencyWarn: 0.45,   // below this = warn (but not critical)
    clutterMaxZones:  15,     // filled zones ≥ this = background-clutter (critical)
    clutterWarnRatio: 0.75,   // filled zones ≥ 75% of total = high-clutter
    centerTolerance:  0.20,   // max centroid offset as fraction of canvas width
    centerWarn:       0.12,   // warn at 60% of tolerance
    maxBlobs:         3,      // ≥ this many disconnected blobs = multiple subjects
    edgeSoftMax:      0.65,   // soft-edge ratio above this = soft-edges (critical-ish)
    edgeSoftWarn:     0.40,   // warn threshold
    passScore:        60,     // minimum qaScore to passesQa
  },
  shirt: {
    label:            'Shirt QA',
    transparencyMin:  0.05,
    transparencyWarn: 0.20,
    clutterMaxZones:  16,     // allow fully filled (background is fine on a shirt)
    clutterWarnRatio: 0.95,
    centerTolerance:  0.30,
    centerWarn:       0.18,
    maxBlobs:         5,
    edgeSoftMax:      0.80,
    edgeSoftWarn:     0.60,
    passScore:        50,
  },
  logo: {
    label:            'Logo QA',
    transparencyMin:  0.20,
    transparencyWarn: 0.40,
    clutterMaxZones:  13,     // stricter — logos must be clean
    clutterWarnRatio: 0.65,
    centerTolerance:  0.15,
    centerWarn:       0.09,
    maxBlobs:         2,
    edgeSoftMax:      0.45,
    edgeSoftWarn:     0.25,
    passScore:        70,
  },
};

/* ====================================================
   DPI CHECK  — pixel math only, ignore metadata DPI
   ====================================================
   Always use:  pixels ÷ inches = effective DPI
   Never trust the DPI metadata from the API — it's
   almost always 72 or 96 regardless of true resolution.

   Rule: effective DPI ≥ 300  →  print-ready
   ================================================== */

/**
 * ppDpiCheck(widthPx, inches) → { dpi, required, ok, grade }
 *
 * @param {number} widthPx  — actual pixel width of the image
 * @param {number} inches   — target print size in inches
 * @returns {{ dpi:number, required:number, ok:boolean, grade:string }}
 */
function ppDpiCheck(widthPx, inches) {
  const dpi      = Math.round(widthPx / inches);
  const required = 300;
  const ok       = dpi >= required;
  // Grade: ✅ ≥300 | ⚠️ 200–299 | ❌ <200
  const grade    = dpi >= 300 ? 'pass' : dpi >= 200 ? 'warn' : 'fail';
  return { dpi, required, ok, grade };
}

/* ====================================================
   PREMIUM MERCH ENGINE
   ----------------------------------------------------------------
   Automatic design intelligence that turns any user input into
   professional, wearable, premium-looking merchandise.

   Pipeline:  userText
     → ppSanitizeInput()   — strip filler
     → ppAnalyzePrompt()   — classify intent + extract text
     → ppCleanText()       — headline / subtext split
     → ppSelectLayout()    — pick composition preset
     → ppSelectPalette()   — pick premium color combo
     → ppBuildPrompt()     — assemble enforced API prompt
     → ppWearabilityCheck()— final quality gate
   ---------------------------------------------------------------- */

/* ── Negative prompt (pass as `negative_prompt` to the API) ───── */
const PP_NEGATIVE_PROMPT =
  'beach, ocean, scenery, landscape, nature, sky, background clutter, ' +
  'background scene, environment, forest, city, room, indoors, outdoors, ' +
  'multiple objects, extra objects, crowded, busy composition, ' +
  'text overlay, watermark, signature, logo bug, ' +
  'people, person, human, face, hands (unless explicitly requested), ' +
  'low contrast, blurry, soft edges, gradient sky, vignette, photo texture, ' +
  'realistic photograph, photorealistic, stock photo, 3d render, ' +
  'grainy, noisy, dark, moody, cinematic, dramatic lighting, ' +
  'rainbow colors, neon chaos, too many colors, cluttered, messy, ' +
  'fuzzy edges, drop shadow, bevel, emboss, glow effect, lens flare, ' +
  'busy pattern, complex background, multiple fonts, handwriting font';

/* ── Style presets (mapped to style-variant chips) ────────────── */
const PP_STYLES = {
  minimal:   'ultra-minimal, clean lines, flat design, single color, lots of empty space, less is more',
  bold:      'bold streetwear, thick outlines, high contrast, heavy weight, strong shapes, centered',
  cartoon:   'cartoon style, cell-shaded, clean outlines, fun and playful, sticker-ready, flat color',
  realistic: 'detailed illustration, realistic proportions, clean white background, no scene',
  funny:     'funny, humorous, exaggerated features, cartoon expression, clean composition',
  retro:     'retro vintage style, limited 2-color palette, screen-print look, distressed texture',
};

/* ── Premium color palettes ──────────────────────────────────── */
const PP_PALETTES = [
  { name: 'Classic',    colors: ['#111111', '#FFFFFF'], desc: 'black and white' },
  { name: 'Bold',       colors: ['#111111', '#D0021B'], desc: 'black and red' },
  { name: 'Vintage',    colors: ['#F5F0E8', '#111111'], desc: 'cream and black' },
  { name: 'Navy',       colors: ['#0A2463', '#FFFFFF'], desc: 'navy and white' },
  { name: 'Earth',      colors: ['#1B4332', '#D4A574'], desc: 'dark green and beige' },
  { name: 'Mono',       colors: ['#111111'],            desc: 'single black' },
];

/* ── Design layout presets ───────────────────────────────────── */
const PP_LAYOUTS = {
  'center-icon': {
    label: 'Minimal Logo',
    instruction:
      'Small centered graphic with large empty space around it. ' +
      'Clean, premium, subtle. Like a high-end brand logo tee. ' +
      'The design occupies at most 30% of the canvas. ' +
      'Lots of breathing room on all sides.',
  },
  'streetwear': {
    label: 'Streetwear Bold',
    instruction:
      'Bold centered graphic, strong visual impact. ' +
      'Thick clean outlines, high contrast, streetwear aesthetic. ' +
      'Design fills about 60% of canvas, perfectly centered. ' +
      'Balanced composition, heavy visual weight.',
  },
  'badge': {
    label: 'Badge / Emblem',
    instruction:
      'Circular or shield-shaped badge emblem design. ' +
      'Everything contained inside the badge shape. ' +
      'Structured, symmetrical, centered. ' +
      'Like a varsity or vintage brand patch.',
  },
  'top-bottom': {
    label: 'Top + Bottom Text',
    instruction:
      'Text at top, centered graphic in middle, secondary text at bottom. ' +
      'Bold uppercase typography top and bottom. ' +
      'Clean hierarchy: large headline, smaller subtext. ' +
      'Balanced spacing, nothing touches edges.',
  },
};

/* ── Filler words to strip ───────────────────────────────────── */
const PP_FILLER_WORDS = /\b(please|make|create|draw|generate|design|show me|i want|give me|can you|could you|just|really|very|super|like|with|for|shirt|tee|tshirt|t-shirt|hoodie|print|something|thing|stuff|cool|nice|awesome|amazing|great|good|put|on|it|my|me|that|this|some|have|need|get)\b/gi;

/**
 * ppSanitizeInput(raw) — strip filler words, keep the literal subject.
 */
function ppSanitizeInput(raw) {
  return raw
    .replace(PP_FILLER_WORDS, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * ppCleanText(raw) → { headline, subtext }
 *
 * Takes messy user input like "best dad ever birthday party 2024 funny"
 * and produces clean, wearable typography:
 *   headline: "BEST DAD EVER"
 *   subtext:  "EST. 2024"
 */
function ppCleanText(raw) {
  const cleaned = ppSanitizeInput(raw);
  const words   = cleaned.split(/\s+/).filter(Boolean);

  // Extract year if present (4-digit number 1900–2099)
  let year = null;
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) year = yearMatch[1];

  // Remove the year from main words
  const mainWords = words.filter(w => w !== year);

  // Headline: first 3–4 most important words, uppercase
  const headline = mainWords.slice(0, 4).join(' ').toUpperCase() || cleaned.toUpperCase();

  // Subtext: year with "EST." prefix, or remaining words
  let subtext = '';
  if (year) {
    subtext = `EST. ${year}`;
  } else if (mainWords.length > 4) {
    subtext = mainWords.slice(4, 7).join(' ').toUpperCase();
  }

  return { headline, subtext };
}

/**
 * ppAnalyzePrompt(raw) → analysis object
 *
 * Classifies the user's intent and selects the best layout,
 * palette, and typography approach automatically.
 */
function ppAnalyzePrompt(raw) {
  const lower   = raw.toLowerCase();
  const cleaned = ppSanitizeInput(raw);
  const text    = ppCleanText(raw);
  const words   = cleaned.split(/\s+/).filter(Boolean);

  // Detect features
  const hasYear   = /\b(19\d{2}|20\d{2})\b/.test(raw);
  const hasName   = /\b(dad|mom|grandpa|grandma|brother|sister|uncle|aunt|son|daughter|wife|husband|family|team|crew|squad|group|class of)\b/i.test(raw);
  const hasEvent  = /\b(birthday|reunion|wedding|party|anniversary|graduation|bachelor|memorial|fundraiser|championship|tournament)\b/i.test(raw);
  const hasLogo   = /\b(logo|brand|emblem|crest|seal|insignia|monogram)\b/i.test(raw);
  const hasBadge  = /\b(badge|patch|circle|shield|varsity|vintage|retro|est\.?|established|founded|since)\b/i.test(raw);
  const hasAnimal = /\b(dog|cat|bear|eagle|lion|wolf|tiger|dragon|snake|bird|fish|shark|bull|deer|fox|owl|horse|skull)\b/i.test(raw);
  const hasText   = /\b(text|quote|saying|slogan|words|typography|lettering|font)\b/i.test(raw) || words.length >= 4;
  const isSimple  = words.length <= 2 && !hasText;

  // Auto-select layout
  let layoutKey = 'center-icon'; // default: minimal logo

  if (hasBadge || (hasYear && hasName)) {
    layoutKey = 'badge';
  } else if (hasEvent || (hasYear && hasText)) {
    layoutKey = 'top-bottom';
  } else if (hasText && !isSimple) {
    layoutKey = 'streetwear';
  } else if (isSimple || hasLogo) {
    layoutKey = 'center-icon';
  } else if (hasAnimal || hasName) {
    layoutKey = 'streetwear';
  }

  // Auto-select palette based on mood
  let paletteIdx = 0; // default: Classic black/white
  if (/\b(fire|red|hot|blood|danger|stop)\b/i.test(raw))        paletteIdx = 1; // Bold
  else if (/\b(vintage|retro|classic|old school|est)\b/i.test(raw)) paletteIdx = 2; // Vintage
  else if (/\b(navy|ocean|sea|marine|nautical|sail)\b/i.test(raw))  paletteIdx = 3; // Navy
  else if (/\b(nature|earth|forest|green|outdoor|camp)\b/i.test(raw)) paletteIdx = 4; // Earth
  else if (isSimple)                                               paletteIdx = 5; // Mono

  return {
    subject:    cleaned,
    headline:   text.headline,
    subtext:    text.subtext,
    layoutKey,
    paletteIdx,
    palette:    PP_PALETTES[paletteIdx],
    layout:     PP_LAYOUTS[layoutKey],
    hasYear,
    hasName,
    hasEvent,
    hasLogo,
    hasBadge,
    hasAnimal,
    hasText,
    isSimple,
  };
}

/**
 * ppBuildPrompt(userText, styleKey?) → full enforced prompt string.
 *
 * Runs the full Premium Merch Engine pipeline:
 *   analyze → layout → palette → typography → safe-zone → polish
 */
function ppBuildPrompt(userText, styleKey) {
  const analysis = ppAnalyzePrompt(userText);

  // Store analysis on state so other systems (badge, regen) can read it
  if (typeof aiGenState !== 'undefined') {
    aiGenState._lastAnalysis = analysis;
  }

  // Style note
  const styleNote = styleKey && PP_STYLES[styleKey]
    ? PP_STYLES[styleKey]
    : 'clean, vector-like, bold outlines, flat color';

  // Color note from color toolkit override or auto-palette
  let colorNote = '';
  if (aiGenState && aiGenState._ctColorNote) {
    colorNote = aiGenState._ctColorNote;
  } else {
    colorNote = `Color palette: ${analysis.palette.desc} only. ` +
      `Maximum ${analysis.palette.colors.length} colors. No rainbow. No gradients.`;
  }

  // Layout instruction
  const layoutInst = analysis.layout.instruction;

  // Typography instruction (for layouts with text)
  let typographyInst = '';
  if (analysis.headline) {
    typographyInst = `\nTypography: bold uppercase sans-serif.`;
    if (analysis.layoutKey === 'top-bottom' && analysis.subtext) {
      typographyInst += ` Main text: "${analysis.headline}" large and dominant.` +
        ` Secondary text: "${analysis.subtext}" smaller below.`;
    } else if (analysis.layoutKey === 'badge') {
      typographyInst += ` Text "${analysis.headline}" integrated into the badge shape.`;
      if (analysis.subtext) typographyInst += ` "${analysis.subtext}" as smaller banner or ribbon.`;
    }
    typographyInst += ` Maximum 2 fonts. Clean, readable, no script fonts.`;
  }

  return (
    /* Subject */
    `A premium, professionally designed t-shirt graphic of: ${analysis.subject}.` +
    /* Composition */
    `\nComposition: ${layoutInst}` +
    /* Core rules */
    `\nSingle focused design element only.` +
    `\nNo background scene, no environment, no extra objects.` +
    `\nNo people unless the subject is a person.` +
    `\nPlain white or transparent background.` +
    /* Premium quality */
    `\nPremium quality: sharp edges, clean lines, no blur, no fuzzy edges.` +
    `\nNo messy gradients, no drop shadows, no glow effects.` +
    `\nFlat, bold, high contrast. Looks like real printed merchandise.` +
    /* Spacing */
    `\nSpacing: generous padding on all sides. Nothing touches edges.` +
    `\nPerfectly centered. Balanced weight distribution.` +
    `\nDesign stays inside a safe print zone with clear margins.` +
    /* Typography */
    typographyInst +
    /* Color */
    `\n${colorNote}` +
    /* Style */
    `\nStyle: ${styleNote}.` +
    /* Final polish */
    `\nFinal quality: this must look like something a person would actually wear in public.` +
    `\nPremium, polished, intentional. Not clip-art, not random, not busy.`
  );
}

/**
 * ppWearabilityCheck(analysis) → { pass, reason }
 *
 * Quick heuristic: would this prompt produce a wearable result?
 * If not, returns a simplified version of the subject.
 */
function ppWearabilityCheck(analysis) {
  const wordCount = analysis.subject.split(/\s+/).length;

  // Too many words = cluttered
  if (wordCount > 8) {
    return {
      pass: false,
      reason: 'too-complex',
      simplified: analysis.subject.split(/\s+/).slice(0, 4).join(' '),
    };
  }

  // Conflicting instructions
  if (analysis.hasAnimal && analysis.hasEvent && analysis.hasText) {
    return {
      pass: false,
      reason: 'too-busy',
      simplified: analysis.subject.split(/\s+/).slice(0, 3).join(' '),
    };
  }

  return { pass: true, reason: null, simplified: null };
}

/**
 * ppDetectFailure(result, userSubject) — heuristic fail check.
 * NOTE: gpt-image-1 never returns description/alt/label metadata,
 * so this always returns false. Real failure detection is now handled
 * by ppQaInspect() via canvas pixel analysis.
 */
function ppDetectFailure(result, userSubject) {
  const desc = ((result.description || result.alt || result.label || '') + '').toLowerCase();
  const failWords = [
    'beach', 'ocean', 'landscape', 'forest', 'city', 'room', 'sky',
    'background', 'scene', 'outdoors', 'people', 'crowd',
    'gradient', 'rainbow', 'cluttered', 'blurry', 'busy',
  ];
  if (!desc) return false;
  return failWords.some(w => desc.includes(w));
}

/* ====================================================
   POST-GENERATION IMAGE QA SYSTEM
   ====================================================
   ppQaInspect(img, subject) — canvas pixel-analysis QA.

   Runs 5 checks after each image loads:

   1. TRANSPARENCY QUALITY  — alpha channel ratio.
      Samples a grid of pixels and measures what fraction
      are fully/mostly transparent.  Low transparent-px
      ratio → background is filled → bad for stickers.

   2. BACKGROUND CLUTTER   — opaque pixel distribution.
      Measures how spread opaque pixels are across the
      canvas.  Very high spread with no clear centroid →
      likely scenery / filled background.

   3. CENTERING CHECK      — center-of-mass of opaque pixels.
      Computes the weighted centroid.  Far from canvas
      center → subject is off-center.

   4. SUBJECT COUNT        — checks prompt text for known
      multi-subject patterns AND checks whether opaque
      pixel mass has multiple separated blobs.
      Also flags subjects connected by "and/with/plus".

   5. EDGE QUALITY         — soft-edge heuristic.
      Samples the alpha channel near the boundary between
      opaque and transparent regions.  Many semi-transparent
      pixels in that zone → blurry/soft edges.

   Returns:
   {
     qaScore:   0-100  (100 = perfect),
     qaIssues:  string[],
     passesQa:  boolean
   }

   Result is cached on the img object as img._qa so the
   canvas work only runs once per image.
   ================================================== */

/**
 * ppQaInspect(img, subject) → Promise<{ qaScore, qaIssues, passesQa }>
 *
 * @param {{ url:string, widthPx:number, heightPx:number }} img
 * @param {string} subject — the cleaned subject text (for prompt heuristics)
 */
async function ppQaInspect(img, subject) {
  // Return cached result if we already ran this
  if (img._qa) return img._qa;

  const cfg    = QA_CONFIG[QA_MODE] || QA_CONFIG.sticker;
  const issues = [];
  let score    = 100;

  // ── PROMPT HEURISTICS (no canvas needed) ──────────────────
  // Check 4a: subject count via text — "X and Y", "X with Y", "X plus Y"
  const subjectLower = (subject || '').toLowerCase();
  const multiPattern = /\b(and|with|plus|also|&)\b/;
  const multiSubjects = multiPattern.test(subjectLower) &&
    // Allow "bear with sunglasses" — only flag if BOTH sides look like nouns
    // Simple heuristic: 3+ words total separated by the connector
    subjectLower.split(multiPattern).filter(p => p.trim().split(/\s+/).length >= 2).length >= 2;

  if (multiSubjects) {
    issues.push('multiple-subjects-prompt');
    score -= 20;
  }

  // ── CANVAS PIXEL ANALYSIS ─────────────────────────────────
  // Load image into an offscreen canvas, read pixel data.
  // Skip if the browser can't do this (old browser / cross-origin).
  let pixelData = null;
  let W = 0, H = 0;

  try {
    const bitmap = await createImageBitmap(
      await fetch(img.url).then(r => r.blob())
    );
    W = bitmap.width  || img.widthPx  || 1024;
    H = bitmap.height || img.heightPx || 1024;

    const canvas = document.createElement('canvas');
    // Downsample to 128×128 for speed — enough for statistical checks
    const SAMPLE = 128;
    canvas.width  = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
    bitmap.close();

    pixelData = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    W = SAMPLE; H = SAMPLE;
  } catch (e) {
    // Cross-origin or fetch blocked — cannot run canvas checks, fail safe
    console.warn('[PrintPath QA] Canvas analysis skipped:', e.message);
    issues.push('qa-skipped-cors');
    const qa = {
      qaScore:  0,
      qaIssues: issues,
      passesQa: false,
      qaMode:   QA_MODE,
      corsSkipped: true,
    };
    img._qa = qa;
    return qa;
  }

  // Helper: get RGBA at (x,y) in flat Uint8ClampedArray
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return { r: pixelData[i], g: pixelData[i+1], b: pixelData[i+2], a: pixelData[i+3] };
  };

  let totalPx      = W * H;
  let transparentPx = 0;   // alpha < 20
  let opaquePx     = 0;    // alpha > 200
  let semiPx       = 0;    // 20 ≤ alpha ≤ 200
  let sumX = 0, sumW = 0;  // for centroid
  let sumY = 0;

  // Also track a 4×4 zone grid for clutter/blob analysis
  const ZONES = 4;
  const zoneOpaqueCount = new Array(ZONES * ZONES).fill(0);
  const zoneW = Math.floor(W / ZONES);
  const zoneH = Math.floor(H / ZONES);

  // Track edge-adjacent pixels (within 3px of transparent→opaque boundary)
  let edgeSemiCount = 0;
  let edgeTotalCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { a } = px(x, y);

      if (a < 20)        transparentPx++;
      else if (a > 200)  opaquePx++;
      else               semiPx++;

      // Centroid: weight by opacity
      if (a > 20) {
        sumX += x * a;
        sumY += y * a;
        sumW += a;
      }

      // Zone grid (opaque only)
      if (a > 200) {
        const zx = Math.min(Math.floor(x / zoneW), ZONES - 1);
        const zy = Math.min(Math.floor(y / zoneH), ZONES - 1);
        zoneOpaqueCount[zy * ZONES + zx]++;
      }

      // Edge quality: find pixels near a transparency boundary
      if (a > 20 && a < 200) {
        // Check if any neighbour is very transparent
        const neighbours = [
          x > 0     ? px(x-1, y).a : 0,
          x < W-1   ? px(x+1, y).a : 0,
          y > 0     ? px(x, y-1).a : 0,
          y < H-1   ? px(x, y+1).a : 0,
        ];
        const nearTransparent = neighbours.some(na => na < 20);
        if (nearTransparent) {
          edgeTotalCount++;
          edgeSemiCount++;
        }
      } else if (a > 200) {
        // Opaque pixel — count it for edge total if near transparent
        const neighbours = [
          x > 0     ? px(x-1, y).a : 0,
          x < W-1   ? px(x+1, y).a : 0,
          y > 0     ? px(x, y-1).a : 0,
          y < H-1   ? px(x, y+1).a : 0,
        ];
        if (neighbours.some(na => na < 20)) {
          edgeTotalCount++;
        }
      }
    }
  }

  const transparencyRatio = transparentPx / totalPx;  // 0–1
  const opaqueRatio       = opaquePx / totalPx;       // 0–1
  const semiRatio         = semiPx   / totalPx;       // 0–1

  // ── CHECK 5: TRANSPARENCY QUALITY ─────────────────────────
  if (transparencyRatio < cfg.transparencyMin) {
    issues.push('background-not-transparent');
    score -= 30;
  } else if (transparencyRatio < cfg.transparencyWarn) {
    issues.push('low-transparency');
    score -= 15;
  }

  // ── CHECK 3: BACKGROUND CLUTTER ───────────────────────────
  const zoneThreshold = Math.floor(totalPx / (ZONES * ZONES) * 0.10); // 10% of zone
  const filledZones   = zoneOpaqueCount.filter(c => c > zoneThreshold).length;
  const maxZones      = ZONES * ZONES; // 16

  if (filledZones >= cfg.clutterMaxZones) {
    issues.push('background-clutter');
    score -= 25;
  } else if (filledZones >= Math.floor(maxZones * cfg.clutterWarnRatio)) {
    issues.push('high-clutter');
    score -= 12;
  }

  // ── CHECK 2: CENTERING ─────────────────────────────────────
  if (sumW > 0) {
    const centroidX = sumX / sumW;
    const centroidY = sumY / sumW;
    const centerX   = W / 2;
    const centerY   = H / 2;
    const maxOffset = W * cfg.centerTolerance;
    const offsetX   = Math.abs(centroidX - centerX);
    const offsetY   = Math.abs(centroidY - centerY);

    if (offsetX > maxOffset || offsetY > maxOffset) {
      issues.push('off-center');
      score -= 20;
    } else if (offsetX > maxOffset * (cfg.centerWarn / cfg.centerTolerance) || offsetY > maxOffset * (cfg.centerWarn / cfg.centerTolerance)) {
      issues.push('slightly-off-center');
      score -= 8;
    }
  }

  // ── CHECK 1: SUBJECT COUNT (blob analysis) ─────────────────
  // Use the zone grid: check for multiple separated clusters of opaque zones
  // that are not adjacent to each other.
  // A single centered subject → one cluster of filled zones.
  // Multiple disconnected filled-zone islands → multiple subjects.
  const filledZoneSet = new Set(
    zoneOpaqueCount.map((c, i) => c > zoneThreshold ? i : -1).filter(i => i >= 0)
  );
  // BFS to find connected components in the zone grid
  const visited = new Set();
  let blobCount = 0;
  for (const startZone of filledZoneSet) {
    if (visited.has(startZone)) continue;
    blobCount++;
    // BFS
    const queue = [startZone];
    while (queue.length) {
      const z = queue.shift();
      if (visited.has(z)) continue;
      visited.add(z);
      const zx = z % ZONES;
      const zy = Math.floor(z / ZONES);
      // 4-connected neighbours
      const neighbours = [
        zy > 0        ? (zy-1)*ZONES + zx : -1,
        zy < ZONES-1  ? (zy+1)*ZONES + zx : -1,
        zx > 0        ? zy*ZONES + (zx-1) : -1,
        zx < ZONES-1  ? zy*ZONES + (zx+1) : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && filledZoneSet.has(n) && !visited.has(n)) queue.push(n);
      }
    }
  }

  if (blobCount >= cfg.maxBlobs + 1) {
    issues.push('multiple-subjects-detected');
    score -= 25;
  } else if (blobCount >= cfg.maxBlobs && !multiSubjects) {
    issues.push('possible-multiple-subjects');
    score -= 10;
  }

  // ── CHECK 4b: EDGE QUALITY ─────────────────────────────────
  if (edgeTotalCount > 0) {
    const softEdgeRatio = edgeSemiCount / edgeTotalCount;
    if (softEdgeRatio > cfg.edgeSoftMax) {
      issues.push('soft-edges');
      score -= 20;
    } else if (softEdgeRatio > cfg.edgeSoftWarn) {
      issues.push('slightly-soft-edges');
      score -= 8;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const criticalIssues = ['background-not-transparent', 'background-clutter', 'multiple-subjects-detected'];
  const hasCritical    = issues.some(i => criticalIssues.includes(i));
  const passesQa       = score >= cfg.passScore && !hasCritical;

  const qa = { qaMode: QA_MODE, qaScore: score, qaIssues: issues, passesQa };
  img._qa = qa; // cache on the img object

  // Debug logging
  console.log(
    `[PrintPath QA:${QA_MODE}] ${img.widthPx}×${img.heightPx}px` +
    ` | score: ${score}/${cfg.passScore} (pass threshold)` +
    ` | pass: ${passesQa}` +
    ` | issues: [${issues.join(', ') || 'none'}]` +
    ` | transparent: ${(transparencyRatio * 100).toFixed(1)}% (min ${(cfg.transparencyMin*100).toFixed(0)}%)` +
    ` | blobs: ${blobCount} (max ${cfg.maxBlobs})` +
    ` | softEdge: ${edgeTotalCount > 0 ? ((edgeSemiCount/edgeTotalCount)*100).toFixed(1) : '—'}% (max ${(cfg.edgeSoftMax*100).toFixed(0)}%)`
  );

  return qa;
}

/**
 * ppUpdateLayoutBadge(analysis) — shows the auto-selected layout in the UI.
 */
function ppUpdateLayoutBadge(analysis) {
  const badge = document.getElementById('pp-layout-badge');
  if (!badge || !analysis) return;

  const layoutLabel  = analysis.layout.label;
  const paletteLabel = analysis.palette.name;
  const headlinePreview = analysis.headline
    ? ` · "${analysis.headline}${analysis.subtext ? ' / ' + analysis.subtext : ''}"`
    : '';

  badge.innerHTML =
    `<span class="pp-lb-icon">✦</span>` +
    `<span class="pp-lb-layout">${layoutLabel}</span>` +
    `<span class="pp-lb-sep">·</span>` +
    `<span class="pp-lb-palette">${paletteLabel}</span>` +
    headlinePreview;

  badge.style.display = 'flex';
}

/* ====================================================
   STATE
   ==================================================== */
const aiGenState = {
  open:           false,
  loading:        false,
  results:        [],       // array of { url, prompt, dpi, widthPx, heightPx }
  selected:       null,     // the chosen result object
  lastPrompt:     '',
  bestMatchIndex: 1,        // index highlighted as "Best match" (rotates per generation)
  genCount:       0,        // total generation count for this session
  lastStyle:      null,     // active style chip key
  lastLayout:     null,     // auto-selected layout key
  _lastAnalysis:  null,     // full analysis object from ppAnalyzePrompt
  _ctColorNote:   null,     // color toolkit override
  selectedSizeIdx: AI_GEN_CONFIG.defaultSizeIdx, // active print-size preset
  // Money engine
  meQty:          1,
  meEventType:    null,
  meGroupMode:    'same',
};

/* ====================================================
   AI GENERATION — PLACEHOLDER
   ----------------------------------------------------------------
   TO CONNECT A REAL API:
     1. Replace the body of generateDesign() with a real fetch().
     2. Map the API response to the { url, prompt, dpi, widthPx, heightPx } shape.
     3. Update AI_GEN_CONFIG.apiOutputDpi and apiOutputPx to match.

   Suggested APIs:
     - OpenAI DALL·E 3:   POST https://api.openai.com/v1/images/generations
     - Stability AI:       POST https://api.stability.ai/v1/generation/...
     - Replicate:          POST https://api.replicate.com/v1/predictions
   ---------------------------------------------------------------- */

/**
 * generateDesign(prompt) → Promise<Array<{url, prompt, dpi, widthPx, heightPx}>>
 *
 * PLACEHOLDER: returns 4 royalty-free placeholder image URLs after a fake delay.
 * Replace the function body with a real API call when ready.
 */
async function generateDesign(subject, style, layout, colorNote) {
  const endpoint = AI_GEN_CONFIG.serverUrl + AI_GEN_CONFIG.generatePath;

  // Debug: log what we're sending
  console.log('[PrintPath] generateDesign → subject:', subject, '| style:', style, '| layout:', layout);

  let res;
  try {
    res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ subject, style, layout, colorNote }),
    });
  } catch (networkErr) {
    throw new Error('Cannot reach the PrintPath server. Is it running? (node server/server.js)');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (res.status === 400) throw new Error(errData.error || 'Prompt was rejected — try rewording.');
    if (res.status === 401) throw new Error('OpenAI API key is invalid. Check server/.env.');
    if (res.status === 429) throw new Error('Rate limited by OpenAI. Wait a moment and try again.');
    throw new Error(errData.error || `Server error ${res.status}`);
  }

  const data = await res.json();
  const images = data.images || [];

  if (!images.length) throw new Error('No images returned. Try a different description.');

  return images.map(img => ({
    url:          img.url,
    prompt:       subject,
    dpi:          img.dpi      || AI_GEN_CONFIG.apiOutputDpi,
    widthPx:      img.width    || AI_GEN_CONFIG.apiOutputPx,
    heightPx:     img.height   || AI_GEN_CONFIG.apiOutputPx,
    isPrintReady: img.isPrintReady || false,
  }));
}

/* ====================================================
   UPSCALE — PLACEHOLDER
   ----------------------------------------------------------------
   TO CONNECT A REAL UPSCALER:
     1. Replace the body of upscaleImage() with a real fetch().
     2. Return a new { url, dpi, widthPx, heightPx } object.

   Suggested APIs:
     - Replicate Real-ESRGAN: https://replicate.com/nightmareai/real-esrgan
     - Deep AI Super Resolution: https://deepai.org/machine-learning-model/torch-srgan
     - Adobe Firefly upscale (when available via API)
   ---------------------------------------------------------------- */

/**
 * upscaleImage(imageObj) → Promise<{url, dpi, widthPx, heightPx}>
 *
 * PLACEHOLDER: simulates a 4× upscale. Replace with a real API call.
 */
async function upscaleImage(imageObj) {
  // Try the real Replicate upscaler first; fall back to the logical shim
  // if the token isn't configured or the endpoint errors.
  const realEndpoint = AI_GEN_CONFIG.serverUrl + AI_GEN_CONFIG.realUpscalePath;
  const shimEndpoint = AI_GEN_CONFIG.serverUrl + AI_GEN_CONFIG.upscalePath;

  // ── Attempt real upscale (Real-ESRGAN via Replicate) ──────
  let res;
  try {
    res = await fetch(realEndpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: imageObj.url, scale: 4 }),
    });
  } catch (_) {
    res = null; // network error → fall through to shim
  }

  // ── Fallback to logical shim if real upscale unavailable ──
  if (!res || !res.ok) {
    if (res) {
      const errBody = await res.json().catch(() => ({}));
      // 503 = Replicate token not configured — silent fallback
      if (res.status !== 503) {
        console.warn('[PrintPath] Real upscale returned', res.status, errBody.error || '');
      }
    }
    console.log('[PrintPath] Falling back to logical upscale shim…');
    let shimRes;
    try {
      shimRes = await fetch(shimEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: imageObj.url, width: imageObj.widthPx, height: imageObj.heightPx }),
      });
    } catch (networkErr) {
      throw new Error('Cannot reach the PrintPath server. Is it running?');
    }
    if (!shimRes.ok) {
      const errData = await shimRes.json().catch(() => ({}));
      throw new Error(errData.error || `Upscale failed (${shimRes.status})`);
    }
    const shimData = await shimRes.json();
    return {
      url:          shimData.url      || imageObj.url,
      dpi:          shimData.dpi      || imageObj.dpi * 2,
      widthPx:      shimData.width    || imageObj.widthPx  * 2,
      heightPx:     shimData.height   || imageObj.heightPx * 2,
      isPrintReady: shimData.isPrintReady || false,
      upscaled:     true,
      upscaleMethod: 'shim',
    };
  }

  // ── Real upscale succeeded ─────────────────────────────────
  const data     = await res.json();
  const newUrl   = data.url || imageObj.url;
  // Real-ESRGAN 4× scale: output is 4× input dimensions
  const newW     = data.width    || imageObj.widthPx  * 4;
  const newH     = data.height   || imageObj.heightPx * 4;
  const newDpi   = Math.round(newW / 4); // 4" baseline
  const isPR     = newW >= 1200;         // ≥ 4" @ 300 DPI

  console.log(`[PrintPath] Real upscale complete: ${imageObj.widthPx}→${newW}px | DPI: ${newDpi} | printReady: ${isPR}`);

  return {
    url:          newUrl,
    dpi:          newDpi,
    widthPx:      newW,
    heightPx:     newH,
    isPrintReady: isPR,
    upscaled:     true,
    upscaleMethod: 'real-esrgan',
  };
}

/* ====================================================
   SAVE SELECTED DESIGN TO localStorage
   ==================================================== */
function saveAiDesign(imageObj) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(AI_GEN_CONFIG.savedDesignsKey) || '[]');
  } catch (_) { saved = []; }

  // Avoid duplicates
  saved = saved.filter(d => d.url !== imageObj.url);

  saved.unshift({
    url:       imageObj.url,
    prompt:    imageObj.prompt,
    dpi:       imageObj.dpi,
    widthPx:   imageObj.widthPx,
    heightPx:  imageObj.heightPx,
    savedAt:   new Date().toISOString(),
    upscaled:  imageObj.upscaled || false,
  });

  if (saved.length > AI_GEN_CONFIG.savedDesignsMax) {
    saved = saved.slice(0, AI_GEN_CONFIG.savedDesignsMax);
  }

  try {
    localStorage.setItem(AI_GEN_CONFIG.savedDesignsKey, JSON.stringify(saved));
  } catch (e) {
    console.warn('[PrintPath] AI design save failed:', e);
  }
}

/* ====================================================
   MODAL OPEN / CLOSE
   ==================================================== */
function openAiGen() {
  const overlay = document.getElementById('ai-gen-overlay');
  if (!overlay) return;
  aiGenState.open = true;

  // Native-feel entrance
  if (typeof PP !== 'undefined') {
    const modal = overlay.querySelector('.ai-gen-modal');
    PP.openOverlay(overlay, modal, 'center');
  } else {
    overlay.style.display = 'flex';
  }
  document.body.style.overflow = 'hidden';
  history.pushState({ page: 'aigen' }, '', '#ai-design');

  // Focus prompt input — cursor already blinking
  const input = document.getElementById('ai-prompt-input');
  if (input) {
    setTimeout(() => {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 80);
  }

  // Sync QA mode picker to persisted value (both action bar and top selector)
  const qaPicker = document.getElementById('ai-qa-mode-picker');
  if (qaPicker) qaPicker.value = QA_MODE;
  const qaPickerTop = document.getElementById('ai-qa-mode-top');
  if (qaPickerTop) qaPickerTop.value = QA_MODE;
}

function closeAiGen() {
  const overlay = document.getElementById('ai-gen-overlay');
  if (!overlay) return;
  aiGenState.open = false;

  // Feature 8: Save lock-in — notify user their design is saved
  if (aiGenState.results.length > 0) {
    const lock = document.getElementById('ai-save-lock');
    const lockText = document.getElementById('ai-save-lock-text');
    if (lock) {
      const label = aiGenState.lastPrompt
        ? `"${aiGenState.lastPrompt.slice(0, 40)}" is saved — come back any time.`
        : 'Your design is saved — come back any time.';
      if (lockText) lockText.textContent = label;
      lock.style.display = 'flex';
      setTimeout(() => { lock.style.display = 'none'; }, 5000);
    }
  }

  if (typeof PP !== 'undefined') {
    const modal = overlay.querySelector('.ai-gen-modal');
    PP.closeOverlay(overlay, modal, () => {
      document.body.style.overflow = '';
    });
  } else {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

/* ====================================================
   RENDER RESULTS GRID
   ==================================================== */
function aiGenRenderResults() {
  const grid = document.getElementById('ai-results-grid');
  if (!grid) return;

  if (aiGenState.results.length === 0) {
    grid.innerHTML = '';
    return;
  }

  const bestIdx  = aiGenState.bestMatchIndex;
  const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];

  grid.innerHTML = aiGenState.results.map((img, i) => {
    const check    = ppDpiCheck(img.widthPx, sizePreset.inches);
    const selected = aiGenState.selected && aiGenState.selected.url === img.url;
    const isBest   = i === bestIdx;
    const qa       = img._qa || null;

    // DPI badge
    const badgeLabel = check.ok ? 'Print Ready' : check.grade === 'warn' ? 'Upscale Rec.' : 'Needs Upscale';

    // QA badge
    let qaBadgeHtml = '';
    if (qa === null) {
      // QA still running
      qaBadgeHtml = `<span class="ai-qa-badge pending" title="Quality check in progress…">⏳ Checking…</span>`;
    } else if (qa.passesQa) {
      const modeLabel = (qa && QA_CONFIG[qa.qaMode || QA_MODE] || QA_CONFIG[QA_MODE]).label;
      qaBadgeHtml = `<span class="ai-qa-badge pass" title="${modeLabel} · score: ${qa.qaScore}/100">✓ ${modeLabel}</span>`;
    } else {
      // Build a human-readable issue summary (max 2 issues shown)
      const issueLabels = {
        'background-not-transparent': 'No transparency',
        'low-transparency':           'Low transparency',
        'background-clutter':         'Background clutter',
        'high-clutter':               'High clutter',
        'off-center':                 'Off-center',
        'slightly-off-center':        'Slightly off-center',
        'multiple-subjects-detected': 'Multiple subjects',
        'possible-multiple-subjects': 'Possible multi-subject',
        'multiple-subjects-prompt':   'Multi-subject prompt',
        'soft-edges':                 'Soft edges',
        'slightly-soft-edges':        'Slightly soft edges',
        'qa-error':                   'QA unavailable',
      };
      const modeLabel = (QA_CONFIG[qa.qaMode || QA_MODE] || QA_CONFIG[QA_MODE]).label;
      const shown = (qa.qaIssues || []).slice(0, 2)
        .map(k => issueLabels[k] || k).join(' · ');
      qaBadgeHtml = `<span class="ai-qa-badge fail" title="${modeLabel} · score: ${qa.qaScore}/100 | Issues: ${(qa.qaIssues||[]).join(', ')}">⚠ ${shown || 'QA issue'}</span>`;
    }

    // Card-level rejected overlay (critical QA failure)
    const isCriticalFail = qa && !qa.passesQa &&
      (qa.qaIssues || []).some(i => ['background-not-transparent','background-clutter','multiple-subjects-detected'].includes(i));
    const rejectedOverlay = isCriticalFail
      ? `<div class="ai-qa-rejected-overlay" title="Rejected: ${(qa.qaIssues||[]).join(', ')}"><span>⊘ Rejected</span></div>`
      : '';

    return `
      <div class="ai-result-card${selected ? ' selected' : ''}${isBest ? ' best-match' : ''}${isCriticalFail ? ' qa-rejected' : ''} fade-in-card"
           style="animation-delay:${i * 80}ms"
           onclick="aiGenSelectResult(${i})"
           role="button" tabindex="0"
           aria-label="Generated design ${i + 1}${isBest ? ' — best match' : ''}"
           onkeydown="if(event.key==='Enter'||event.key===' ')aiGenSelectResult(${i})">
        ${isBest ? '<div class="ai-best-label">✦ Recommended</div>' : ''}
        <div class="ai-result-img-wrap">
          <img src="${img.url}" alt="Generated design ${i + 1}" class="ai-result-img"
               loading="lazy" crossorigin="anonymous"
               onload="this.closest('.ai-result-card').classList.add('loaded');this.nextElementSibling.style.display='none'"
               onerror="this.closest('.ai-result-card').classList.add('load-error');this.nextElementSibling.style.display='none'" />
          <div class="ai-result-loading-overlay">
            <div class="ai-spinner-sm"></div>
          </div>
          ${rejectedOverlay}
        </div>
        <div class="ai-result-meta">
          <span class="ai-dpi-badge ${check.grade}">${badgeLabel}</span>
          <span class="ai-dpi-num">${check.dpi} DPI · ${img.widthPx}px</span>
        </div>
        <div class="ai-result-qa-row">
          ${qaBadgeHtml}
          ${qa && !qa.passesQa ? `<span class="ai-qa-score">${qa.qaScore}/100</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ====================================================
   SELECT A RESULT
   ==================================================== */
function aiGenSelectResult(index) {
  const img = aiGenState.results[index];
  if (!img) return;

  aiGenState.selected = img;
  aiGenRenderResults(); // re-render to show selection ring

  // Micro reward: pop animation on selected card
  const grid = document.getElementById('ai-results-grid');
  if (grid) {
    const cards = grid.querySelectorAll('.ai-result-card');
    const card = cards[index];
    if (card) {
      card.classList.remove('pop');
      void card.offsetWidth; // reflow to re-trigger
      card.classList.add('pop');
    }
  }

  // Show the action bar
  aiGenShowActionBar(img);
}

/**
 * ppDpiReadout(img) — rebuilds the DPI panel in the action bar.
 * Called whenever the image or the selected size changes.
 */
function ppDpiReadout(img) {
  const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
  const check      = ppDpiCheck(img.widthPx, sizePreset.inches);

  // Size picker: populate options once, keep selection
  const sizePicker = document.getElementById('ai-size-picker');
  if (sizePicker && !sizePicker.dataset.populated) {
    sizePicker.innerHTML = AI_GEN_CONFIG.printSizes
      .map((s, i) => `<option value="${i}">${s.label}</option>`)
      .join('');
    sizePicker.dataset.populated = '1';
    sizePicker.addEventListener('change', () => {
      aiGenState.selectedSizeIdx = parseInt(sizePicker.value, 10);
      if (aiGenState.selected) ppDpiReadout(aiGenState.selected);
      aiGenRenderResults(); // re-badge all cards
    });
  }
  if (sizePicker) sizePicker.value = String(aiGenState.selectedSizeIdx);

  // DPI readout rows
  const reqEl  = document.getElementById('ai-dpi-required');
  const curEl  = document.getElementById('ai-dpi-current');
  const stEl   = document.getElementById('ai-dpi-status');
  const reqPx  = sizePreset.inches * 300;

  if (reqEl) reqEl.textContent = `${reqPx}px`;
  if (curEl) curEl.textContent = `${img.widthPx}px`;
  if (stEl) {
    if (check.ok) {
      stEl.textContent  = '✅ Print Ready';
      stEl.className    = 'ai-dpi-status-val pass';
    } else if (check.grade === 'warn') {
      stEl.textContent  = `⚠️ ${check.dpi} DPI — upscale recommended`;
      stEl.className    = 'ai-dpi-status-val warn';
    } else {
      stEl.textContent  = `❌ ${check.dpi} DPI — too low, upscale required`;
      stEl.className    = 'ai-dpi-status-val fail';
    }
  }

  return check;
}

function aiGenShowActionBar(img) {
  const bar = document.getElementById('ai-action-bar');
  if (!bar) return;

  bar.style.display = 'flex';

  // Keep QA mode picker in sync
  const qaPicker = document.getElementById('ai-qa-mode-picker');
  if (qaPicker && qaPicker.value !== QA_MODE) qaPicker.value = QA_MODE;

  const check = ppDpiReadout(img);

  // Gate 1: DPI / pixel-math
  const sizePreset   = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
  const pixelCheck   = ppDpiCheck(img.widthPx, sizePreset.inches);
  const isPrintReady = img.isPrintReady === true && pixelCheck.ok;

  // Gate 2: QA pass (canvas pixel analysis)
  const qa         = img._qa || null;
  const qaRunning  = qa === null; // still pending
  const passesQa   = qa ? qa.passesQa : false;

  // Final gate: BOTH must pass before Continue buttons unlock
  const canContinue = isPrintReady && passesQa;

  // ── Status badge ──────────────────────────────────────────
  const badge = document.getElementById('ai-action-badge');
  if (badge) {
    const modeCfg = QA_CONFIG[QA_MODE] || QA_CONFIG.sticker;
    if (qaRunning) {
      badge.textContent = `⏳ Running ${modeCfg.label}…`;
      badge.className   = 'ai-action-badge pending';
      badge.title       = `Checking with ${modeCfg.label} (pass threshold: ${modeCfg.passScore})`;
    } else if (!isPrintReady) {
      badge.textContent = `⚠️ ${pixelCheck.dpi} DPI — upscale before sending to print`;
      badge.className   = 'ai-action-badge warn';
      badge.title       = '';
    } else if (!passesQa) {
      const topIssue = (qa.qaIssues || [])[0] || 'quality issue';
      const labels = {
        'background-not-transparent': 'background not transparent',
        'background-clutter':         'background clutter detected',
        'off-center':                 'subject is off-center',
        'multiple-subjects-detected': 'multiple subjects detected',
        'soft-edges':                 'soft/blurry edges detected',
        'low-transparency':           'low transparency',
        'high-clutter':               'high background clutter',
      };
      badge.textContent = `⚠️ ${modeCfg.label} — ${labels[topIssue] || topIssue} (${qa.qaScore}/${modeCfg.passScore})`;
      badge.className   = 'ai-action-badge warn';
      badge.title       = `Issues: ${(qa.qaIssues || []).join(', ')}`;
    } else if (qa && qa.corsSkipped) {
      badge.textContent = '⚠️ QA check unavailable — verify image manually before printing';
      badge.className   = 'ai-action-badge warn';
      badge.title       = 'Canvas analysis was blocked (CORS). Inspect the image before sending to print.';
    } else {
      const qaCfg = QA_CONFIG[qa.qaMode || QA_MODE] || QA_CONFIG.sticker;
      badge.textContent = `✅ Print Ready — ${pixelCheck.dpi} DPI · ${qaCfg.label} ${qa.qaScore}/${qaCfg.passScore}`;
      badge.className   = 'ai-action-badge pass';
      badge.title       = `Mode: ${qaCfg.label} · Pass threshold: ${qaCfg.passScore}`;
      badge.classList.remove('glow-pop');
      void badge.offsetWidth;
      badge.classList.add('glow-pop');
      // Sound + card glow are handled by the progression block below
    }
  }

  // ── Upscale button ─────────────────────────────────────────
  const upscaleBtn = document.getElementById('ai-upscale-btn');
  if (upscaleBtn) upscaleBtn.style.display = isPrintReady ? 'none' : 'inline-flex';

  // ── Improve / variation bar ────────────────────────────────
  const improveBar = document.getElementById('ai-improve-bar');
  if (improveBar) improveBar.style.display = 'flex';

  // ── Continue buttons — gated on BOTH isPrintReady AND passesQa ──
  const stickerBtn = document.getElementById('ai-to-sticker-btn');
  const designBtn  = document.getElementById('ai-to-design-btn');

  const _buildBlockedTitle = (imgObj, preset, dpiOk, qaResult) => {
    if (!dpiOk)
      return `Upscale first — needs ${preset.inches * 300}px, have ${imgObj.widthPx}px`;
    if (qaResult && !qaResult.passesQa)
      return `QA failed (score ${qaResult.qaScore}/100): ${(qaResult.qaIssues || []).join(', ')}`;
    return '';
  };

  // ── Fix Design CTA — shown when blocked, hidden when ready ──
  const fixBtn = document.getElementById('ai-fix-design-btn');
  if (fixBtn) {
    if (!canContinue && !qaRunning) {
      fixBtn.style.display = 'inline-flex';
      if (!isPrintReady) {
        fixBtn.textContent = '⬆ Fix Design — Upscale';
        fixBtn.onclick = () => { const u = document.getElementById('ai-upscale-btn'); if (u) u.click(); };
      } else {
        fixBtn.textContent = '✦ Fix Design — Improve';
        fixBtn.onclick = aiGenImprove;
      }
    } else {
      fixBtn.style.display = 'none';
    }
  }

  if (stickerBtn) {
    stickerBtn.disabled          = !canContinue;
    stickerBtn.title             = !canContinue ? _buildBlockedTitle(img, sizePreset, isPrintReady, qa) : '';
    stickerBtn.style.opacity     = !canContinue ? '0' : '';
    stickerBtn.style.cursor      = !canContinue ? 'not-allowed' : '';
    stickerBtn.style.pointerEvents = !canContinue ? 'none' : '';
  }
  if (designBtn) {
    designBtn.disabled           = !canContinue;
    designBtn.title              = !canContinue ? _buildBlockedTitle(img, sizePreset, isPrintReady, qa) : '';
    designBtn.style.opacity      = !canContinue ? '0' : '';
    designBtn.style.cursor       = !canContinue ? 'not-allowed' : '';
    designBtn.style.pointerEvents = !canContinue ? 'none' : '';
  }

  // ── Fix 6: Confidence toast — pass/fail message ────────────
  const confToast = document.getElementById('ai-confidence-toast');
  if (confToast) {
    confToast.textContent = canContinue
      ? '✦ This will print clean and sharp.'
      : '⚠ Needs adjustment before printing.';
    // Re-attach handlers to avoid stale closures (use data flag to debounce)
    const attachConfidence = (btn) => {
      if (!btn || btn.dataset.confWired === '1') return;
      btn.dataset.confWired = '1';
      btn.addEventListener('mouseenter', () => {
        if (!btn.disabled && confToast) {
          confToast.style.display = 'block';
          confToast.classList.add('conf-visible');
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (confToast) {
          confToast.classList.remove('conf-visible');
          setTimeout(() => { if (!confToast.classList.contains('conf-visible')) confToast.style.display = 'none'; }, 300);
        }
      });
    };
    if (stickerBtn) attachConfidence(stickerBtn);
    if (designBtn)  attachConfidence(designBtn);
  }

  // ── Features 4, 7, 8: Progression + near-miss + print-ready reward ──
  const progMsg = document.getElementById('ai-progression-msg');
  if (progMsg) {
    progMsg.style.display = 'none';
    progMsg.className = 'ai-progression-msg';

    if (!qaRunning && qa) {
      const cfg = QA_CONFIG[qa.qaMode || QA_MODE] || QA_CONFIG.sticker;
      const nearMissThreshold = cfg.passScore - 15;

      if (canContinue) {
        // Feature 6 + 7: Print Ready reward — glow card + sound (once per session per image)
        if (!img._printReadyRewarded) {
          img._printReadyRewarded = true;
          if (typeof ppSound !== 'undefined') ppSound.play('ding');
          // Glow the selected card
          const grid = document.getElementById('ai-results-grid');
          if (grid) {
            const cards = grid.querySelectorAll('.ai-result-card.selected');
            cards.forEach(c => {
              c.classList.remove('print-ready-glow');
              void c.offsetWidth;
              c.classList.add('print-ready-glow');
            });
          }
          // Smart install prompt — user is engaged, design looks great
          if (typeof ppMaybeShowInstall === 'function') {
            setTimeout(ppMaybeShowInstall, 1200); // slight delay after reward
          }
        }
        // Feature 5: Auto-save silently on print-ready
        if (!img._autoSaved) {
          img._autoSaved = true;
          saveAiDesign(img);
          // Show quiet "Saved automatically" near save button
          const saveBtn = document.getElementById('ai-save-btn');
          if (saveBtn) {
            saveBtn.classList.add('auto-saved');
            saveBtn.setAttribute('data-auto-label', 'Saved automatically');
            setTimeout(() => saveBtn.classList.remove('auto-saved'), 3000);
          }
        }
        // Feature 4: Progression text — print ready
        progMsg.textContent = '✦ Print ready — this one\'s a keeper.';
        progMsg.className = 'ai-progression-msg prog-ready';
        progMsg.style.display = 'block';
      } else if (qa.corsSkipped) {
        // Fix 2: CORS-skipped — user needs manual check
        progMsg.textContent = '⚠ QA check unavailable — verify the image looks clean before printing.';
        progMsg.className = 'ai-progression-msg prog-nearmiss';
        progMsg.style.display = 'block';
      } else if (qa.qaScore >= 45 && qa.qaScore <= 55 && !qa.passesQa && isPrintReady) {
        // Fix 7: Tight near-miss band — very specific encouragement
        progMsg.textContent = '⬆ Almost there — one more try.';
        progMsg.className = 'ai-progression-msg prog-nearmiss';
        progMsg.style.display = 'block';
      } else if (qa.qaScore > 55 && qa.qaScore >= nearMissThreshold && !qa.passesQa && isPrintReady) {
        // Wider near-miss
        progMsg.textContent = '⬆ Almost there — try upscaling or regenerating.';
        progMsg.className = 'ai-progression-msg prog-nearmiss';
        progMsg.style.display = 'block';
      } else if (qa.qaScore >= 40) {
        // Getting close
        progMsg.textContent = 'Getting close — try a different style or regenerate.';
        progMsg.className = 'ai-progression-msg prog-close';
        progMsg.style.display = 'block';
      } else if (qa.qaScore < 40 && !qa.passesQa) {
        // Good start
        progMsg.textContent = 'Good start — regenerate or try a cleaner prompt.';
        progMsg.className = 'ai-progression-msg prog-start';
        progMsg.style.display = 'block';
      }
    }
  }

  // Show the color toolkit
  ppCtShow();

  // Show the money engine panel (pass canContinue so it can reflect QA status)
  meShowPanel(img, canContinue);

  // ── Feature 1: Confidence bar ──────────────────────────────
  const confBar = document.getElementById('ai-confidence-bar');
  if (confBar) confBar.style.display = canContinue ? 'flex' : 'none';

  // ── Feature 2: Mockup preview row ─────────────────────────
  const mockupRow = document.getElementById('ai-mockup-row');
  if (mockupRow) {
    mockupRow.style.display = canContinue ? 'flex' : 'none';
    if (canContinue && !mockupRow.dataset.init) {
      mockupRow.dataset.init = '1';
      aiMockupPreview('shirt'); // default preview
    }
  }

  // ── Feature 3: Compare mode buttons ───────────────────────
  const compareRow = document.getElementById('ai-compare-row');
  if (compareRow) {
    compareRow.style.display = aiGenState.results.length > 1 ? 'flex' : 'none';
    aiCompareUpdate();
  }

  // ── Features 5 + 9: Price strip + trust badge ──────────────
  const priceStrip = document.getElementById('ai-price-strip');
  if (priceStrip) priceStrip.style.display = 'flex';
  aiUpdatePrice();

  // ── Feature 10: Send to Print primary CTA ──────────────────
  const sendBtn = document.getElementById('ai-send-to-print-btn');
  if (sendBtn) sendBtn.style.display = canContinue ? 'inline-flex' : 'none';
}

/* ====================================================
   GENERATE — triggered by button or Enter key
   ==================================================== */
async function aiGenSubmit() {
  const input = document.getElementById('ai-prompt-input');
  if (!input) return;

  const rawPrompt = input.value.trim();
  if (!rawPrompt) {
    aiGenShowError('Enter a description first.');
    return;
  }

  aiGenHideError();
  aiGenState.loading        = true;
  aiGenState.results        = [];
  aiGenState.selected       = null;
  aiGenState.lastPrompt     = rawPrompt;   // store raw user text for display / regen
  aiGenState.lastStyle      = aiGenState.lastStyle || null; // preserve active style
  aiGenState.genCount      += 1;
  aiGenState.bestMatchIndex = aiGenState.genCount % 6;

  // Hide previous clean indicator
  const cleanIndicator = document.getElementById('ai-clean-indicator');
  if (cleanIndicator) cleanIndicator.style.display = 'none';

  // ── OpenAI Prompt Cleaning (optional) ───────────────────────
  // Runs first, before the local Premium Merch Engine.
  // Falls back silently to local regex if unavailable.
  let cleanedInput = rawPrompt;

  if (typeof ppOpenAI !== 'undefined') {
    try {
      const cleanResult = await ppOpenAI.clean(rawPrompt);

      // If prompt is unclear, show suggestion and stop
      if (cleanResult.unclear) {
        const suggestion = cleanResult.suggestion || 'Try something more specific — like "a wolf" or "class of 2025".';
        aiGenShowInfo(`✦ ${suggestion}`);
        aiGenState.loading = false;
        return;
      }

      // Use the cleaned subject as input to the merch engine
      if (cleanResult.subject) {
        cleanedInput = cleanResult.cleaned || cleanResult.subject;
      }

      // If OpenAI extracted a style and user hasn't picked one, apply it
      if (cleanResult.style && !aiGenState.lastStyle) {
        const styleKey = cleanResult.style.toLowerCase();
        if (PP_STYLES[styleKey]) {
          aiGenState.lastStyle = styleKey;
        }
      }

      // Show cleaning indicator
      if (cleanIndicator) {
        const src = cleanResult.source === 'openai' ? 'AI' : 'Auto';
        const fromTo = cleanedInput !== rawPrompt
          ? `<span class="ai-ci-from">${rawPrompt}</span> → <span class="ai-ci-to">${cleanedInput}</span>`
          : `<span class="ai-ci-to">${cleanedInput}</span>`;
        cleanIndicator.innerHTML = `<span class="ai-ci-badge">${src}</span> ${fromTo}`;
        cleanIndicator.style.display = 'flex';
      }
    } catch (e) {
      // Silent fallback — local pipeline handles it
      console.warn('[PrintPath] OpenAI clean failed, using raw input:', e.message);
    }
  }
  // ─────────────────────────────────────────────────────────────

  // ── Premium Merch Engine pipeline ───────────────────────────
  // 1. Analyze prompt — auto-selects layout, palette, cleans text
  const analysis = ppAnalyzePrompt(cleanedInput);
  aiGenState._lastAnalysis = analysis;
  aiGenState.lastLayout    = analysis.layoutKey;

  // 2. Wearability gate — auto-simplify if prompt is too complex
  const wearCheck = ppWearabilityCheck(analysis);
  const workingPrompt = wearCheck.pass ? cleanedInput : wearCheck.simplified;
  if (!wearCheck.pass) {
    aiGenShowInfo(`✦ Simplified for best results — ${wearCheck.reason}`);
  }

  // 3. Build fully-enforced print-ready prompt
  const enforcedPrompt = ppBuildPrompt(workingPrompt, aiGenState.lastStyle);
  // ─────────────────────────────────────────────────────────────

  // Extract what the server actually needs: clean subject + style metadata.
  // The server builds the full strict prompt — we send subject+hints, not the
  // full verbose ppBuildPrompt string (avoids double-wrapping contradictions).
  const genSubject   = analysis.subject || workingPrompt;
  const genStyle     = aiGenState.lastStyle || null;
  const genLayout    = analysis.layout ? analysis.layout.instruction : null;
  const genColorNote = (analysis.palette && analysis.palette.desc)
    ? `${analysis.palette.desc} only, maximum ${analysis.palette.colors.length} colors, no gradients`
    : null;

  // Debug log: full pipeline stages
  console.log('[PrintPath] Pipeline:');
  console.log('  1. raw     :', rawPrompt);
  console.log('  2. cleaned :', cleanedInput);
  console.log('  3. subject :', genSubject);
  console.log('  4. style   :', genStyle   || '(none)');
  console.log('  5. layout  :', analysis.layoutKey);
  console.log('  6. prompt  :', enforcedPrompt.slice(0, 120) + '...');

  // Hide old results, layout badge, and panels — show spinner
  const grid = document.getElementById('ai-results-grid');
  if (grid) grid.innerHTML = '';
  const badge = document.getElementById('pp-layout-badge');
  if (badge) badge.style.display = 'none';
  const bar  = document.getElementById('ai-action-bar');
  if (bar) bar.style.display = 'none';
  const improveBar = document.getElementById('ai-improve-bar');
  if (improveBar) improveBar.style.display = 'none';
  const progMsg = document.getElementById('ai-progression-msg');
  if (progMsg) progMsg.style.display = 'none';
  // Hide conversion panels and reset init flags
  ['ai-confidence-bar','ai-mockup-row','ai-mockup-stage','ai-compare-row','ai-price-strip','ai-fix-design-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; delete el.dataset.init; }
  });
  const sendBtn = document.getElementById('ai-send-to-print-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  const mePanel = document.getElementById('me-panel');
  if (mePanel) mePanel.style.display = 'none';
  // Hide color toolkit until a new design is selected
  ppCtHide();
  if (typeof ppSound !== 'undefined') ppSound.play('tick');
  aiGenSetLoading(true);

  try {
    // Send subject + style metadata to server.
    // Server builds the full strict prompt — single source of truth.
    const results = await generateDesign(genSubject, genStyle, genLayout, genColorNote);

    // ── Failure detection — pixel-math DPI gate ────────────────
    const minViablePx = 900;
    const failCount   = results.filter(r => (r.widthPx || 0) < minViablePx).length;
    if (failCount === results.length && aiGenState.genCount < 99) {
      const retrySubject = ppSanitizeInput(rawPrompt).split(/\s+/).slice(0, 3).join(' ');
      console.log('[PrintPath] Auto-retry with simplified subject:', retrySubject);
      const retryResults = await generateDesign(retrySubject, genStyle, null, null);
      aiGenState.results = retryResults;
      aiGenShowInfo('✦ Auto-refined — showing improved results.');
    } else {
      aiGenState.results = results;
    }
    // ────────────────────────────────────────────────────────────

    // ── QA INSPECTION — run on every result in parallel ────────
    // ppQaInspect loads each image into an offscreen canvas and runs
    // 5 pixel-analysis checks. Results are cached on img._qa.
    // We render first (so the user sees images immediately), then
    // re-render after QA to attach badges — non-blocking UX.
    ppUpdateLayoutBadge(aiGenState._lastAnalysis);
    aiGenRenderResults(); // first render: no QA badges yet

    // Native-feel: stagger card entrance animation
    if (typeof PP !== 'undefined') {
      const grid = document.getElementById('ai-results-grid');
      if (grid) PP.staggerResultCards(grid);
    }
    if (typeof ppSound !== 'undefined') ppSound.play('whoosh');

    // Run QA in parallel, then re-render with badges
    Promise.all(
      aiGenState.results.map(img => ppQaInspect(img, genSubject).catch(() => ({
        qaScore: 0, qaIssues: ['qa-error'], passesQa: false,
      })))
    ).then(qaResults => {
      // Merge QA results back onto each image object
      qaResults.forEach((qa, i) => {
        if (aiGenState.results[i]) {
          aiGenState.results[i]._qa = qa;
        }
      });

      // Feature 2: Update bestMatchIndex to card with highest qaScore
      let bestScore = -1, bestQaIdx = 0;
      aiGenState.results.forEach((img, i) => {
        const score = img._qa ? img._qa.qaScore : 0;
        if (score > bestScore) { bestScore = score; bestQaIdx = i; }
      });
      aiGenState.bestMatchIndex = bestQaIdx;

      // Re-render grid with QA badges now attached
      aiGenRenderResults();
      // If user already selected an image, refresh the action bar gate
      if (aiGenState.selected) {
        const freshSelected = aiGenState.results.find(r => r.url === aiGenState.selected.url);
        if (freshSelected) {
          aiGenState.selected = freshSelected;
          aiGenShowActionBar(freshSelected);
        }
      }
    });
    // ────────────────────────────────────────────────────────────

  } catch (err) {
    console.error('[PrintPath AI Gen]', err);
    const msg = (err && err.message) ? err.message : 'Generation failed — try a different description.';
    aiGenShowError(msg);
  } finally {
    aiGenState.loading = false;
    aiGenSetLoading(false);
  }
}

/* ====================================================
   UPSCALE SELECTED
   ==================================================== */
async function aiGenUpscale() {
  if (!aiGenState.selected) return;

  const upscaleBtn = document.getElementById('ai-upscale-btn');
  if (upscaleBtn) {
    upscaleBtn.disabled     = true;
    upscaleBtn.textContent  = '⏳ Upscaling…';
  }

  try {
    const upscaled = await upscaleImage(aiGenState.selected);

    // Replace the selected entry in results array
    const idx = aiGenState.results.findIndex(r => r.url === aiGenState.selected.url);
    if (idx !== -1) {
      // Clear QA cache — upscale may return a new URL / different pixel data
      const merged = Object.assign({}, aiGenState.results[idx], upscaled);
      delete merged._qa;  // force re-inspect on new dimensions
      aiGenState.results[idx] = merged;
      aiGenState.selected     = merged;
    }

    aiGenRenderResults();
    aiGenShowActionBar(aiGenState.selected); // shows ⏳ QA pending

    // Re-run QA on the upscaled image
    const subjectForQa = aiGenState.lastPrompt || '';
    ppQaInspect(aiGenState.selected, subjectForQa).then(qa => {
      aiGenState.selected._qa = qa;
      const idx2 = aiGenState.results.findIndex(r => r.url === aiGenState.selected.url);
      if (idx2 !== -1) aiGenState.results[idx2]._qa = qa;
      aiGenRenderResults();
      aiGenShowActionBar(aiGenState.selected);
    }).catch(() => {});

    const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
    const check      = ppDpiCheck(aiGenState.selected.widthPx, sizePreset.inches);
    if (check.ok) {
      aiGenShowInfo('✓ Upscale complete — running QA check…');
    } else {
      aiGenShowInfo(`Upscaled to ${check.dpi} DPI at ${sizePreset.inches}". For ${Math.ceil(aiGenState.selected.widthPx / 300)}" max print size at 300 DPI.`);
    }
  } catch (err) {
    console.error('[PrintPath AI Upscale]', err);
    aiGenShowError('Upscale failed. Try again or use a smaller print size.');
  } finally {
    if (upscaleBtn) {
      upscaleBtn.disabled    = false;
      upscaleBtn.textContent = '⬆ Upscale for Print';
    }
  }
}

/* ====================================================
   SEND TO STICKER LAB
   ==================================================== */
async function aiGenSendToStickerLab() {
  const img = aiGenState.selected;
  if (!img) { aiGenShowError('Select a design first.'); return; }

  // Smart install prompt — user is continuing to production
  if (typeof ppMaybeShowInstall === 'function') ppMaybeShowInstall();

  // DPI check using pixel math — warn but don't hard-block (Sticker Lab has its own check)
  const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
  const dpiCheck   = ppDpiCheck(img.widthPx, sizePreset.inches);
  if (!dpiCheck.ok) {
    const ok = confirm(
      `This design is ${dpiCheck.dpi} DPI at ${sizePreset.inches}" — below 300 DPI for print.\n\n` +
      `Click OK to open in Sticker Lab anyway (the DPI checker will flag it),\n` +
      `or Cancel to upscale first.`
    );
    if (!ok) return;
  }

  // Save to localStorage before leaving
  saveAiDesign(img);

  // Close the AI Gen panel first
  closeAiGen();

  // Load the image via fetch→blob so Sticker Lab can use it as a local file
  // This avoids cross-origin canvas tainting for export
  try {
    const blob = await fetchImageAsBlob(img.url);
    const file = new File([blob], 'ai-design.png', { type: blob.type || 'image/png' });

    // Open Sticker Lab and inject the file
    openStickerLab();
    // Small delay to let the lab initialise its DOM
    setTimeout(() => {
      slHandleFile(file);
      if (typeof showToast === 'function') {
        showToast('🎨 AI design loaded into Sticker Lab!', 'success');
      }
    }, 120);
  } catch (err) {
    console.error('[PrintPath AI→StickerLab]', err);
    // Fallback: pass URL directly if blob fetch fails (cross-origin)
    openStickerLab();
    setTimeout(() => {
      aiGenLoadUrlIntoStickerLab(img.url);
      if (typeof showToast === 'function') {
        showToast('🎨 AI design loaded into Sticker Lab!', 'success');
      }
    }, 120);
  }
}

/* ====================================================
   SEND TO DESIGN LAB (shirt)
   ==================================================== */
async function aiGenSendToDesignLab() {
  const img = aiGenState.selected;
  if (!img) { aiGenShowError('Select a design first.'); return; }

  // Fix 3: Guard BEFORE closing the modal — don't strand the user
  if (typeof state === 'undefined' || !state.products || state.products.length === 0) {
    aiGenShowError('Open a product in Design Lab first, then come back to apply this design.');
    return;
  }

  // Smart install prompt — user is continuing to production
  if (typeof ppMaybeShowInstall === 'function') ppMaybeShowInstall();

  saveAiDesign(img);
  closeAiGen();

  const target = state.products[0];
  openDesignLab(target.id);

  setTimeout(() => {
    const mainImg = document.getElementById('dl-main-img');
    if (mainImg) {
      mainImg.src = img.url;
      mainImg.alt = 'AI generated design';
    }
    if (typeof showToast === 'function') {
      showToast('👕 AI design applied to Design Lab!', 'success');
    }
  }, 180);
}

/* ====================================================
   HELPERS
   ==================================================== */

/**
 * Fetch an image URL and return a Blob.
 * Handles CORS — will throw if the remote server doesn't allow it.
 */
async function fetchImageAsBlob(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Fallback: load a URL string directly into Sticker Lab
 * without blob conversion (canvas export may be blocked by CORS).
 */
function aiGenLoadUrlIntoStickerLab(url) {
  if (!stickerState || !sl) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    stickerState.image         = img;
    stickerState.imageNaturalW = img.naturalWidth;
    stickerState.imageNaturalH = img.naturalHeight;
    stickerState.imageUrl      = url;
    stickerState.x             = 0;
    stickerState.y             = 0;
    stickerState.scale         = 1;
    stickerState.rotation      = 0;
    stickerState.exportUrl     = null;
    stickerState.exportBlob    = null;

    if (sl.scaleSlider)  sl.scaleSlider.value  = 100;
    if (sl.rotSlider)    sl.rotSlider.value    = 0;
    if (sl.scaleValue)   sl.scaleValue.textContent = '100%';
    if (sl.rotValue)     sl.rotValue.textContent   = '0°';

    if (typeof slHideError  === 'function') slHideError();
    if (typeof slCheckDpi   === 'function') slCheckDpi();
    if (typeof slRender     === 'function') slRender();
    if (typeof slUpdatePreview === 'function') slUpdatePreview();
  };
  img.onerror = () => {
    if (typeof slShowError === 'function')
      slShowError('Could not load the AI-generated image. Try downloading it and uploading manually.');
  };
  img.src = url;
}

// Smart loading text sequence
const AI_LOADING_STEPS = [
  'Creating design',
  'Refining layout',
  'Optimizing for print',
  'Finalizing',
];
let _loadingTimer = null;

function aiGenSetLoading(on) {
  const btn      = document.getElementById('ai-generate-btn');
  const spinner  = document.getElementById('ai-spinner');
  const hint     = document.getElementById('ai-results-hint');
  const regenBar = document.getElementById('ai-regen-bar');
  const loadText = document.getElementById('ai-loading-text');
  const grid     = document.getElementById('ai-results-grid');

  if (btn) {
    btn.disabled    = on;
    btn.textContent = on ? 'Creating…' : 'Create Design';
  }
  if (spinner) spinner.style.display = on ? 'flex' : 'none';
  if (hint)    hint.style.display    = on ? 'none' : (aiGenState.results.length ? 'none' : 'block');
  if (regenBar && !on && aiGenState.results.length > 0) regenBar.style.display = 'flex';

  // Skeleton cards — show 4 placeholders while loading
  if (grid) {
    if (on) {
      grid.innerHTML = Array(4).fill(0).map(() =>
        `<div class="ai-result-card ai-skeleton-card">
          <div class="ai-skeleton-img"></div>
          <div class="ai-skeleton-line ai-skeleton-line--wide"></div>
          <div class="ai-skeleton-line ai-skeleton-line--narrow"></div>
        </div>`
      ).join('');
    } else {
      // Skeletons will be replaced by aiGenRenderResults — nothing needed here
    }
  }

  // Cycle through loading messages
  if (_loadingTimer) { clearInterval(_loadingTimer); _loadingTimer = null; }
  if (on && loadText) {
    let step = 0;
    loadText.textContent = AI_LOADING_STEPS[0];
    _loadingTimer = setInterval(() => {
      step = (step + 1) % AI_LOADING_STEPS.length;
      loadText.textContent = AI_LOADING_STEPS[step];
    }, 900);
  }
}

/* ====================================================
   SAVE DESIGN — with in-modal confirmation toast
   ==================================================== */
function aiGenSaveDesign() {
  const img = aiGenState.selected;
  if (!img) return;
  saveAiDesign(img);
  if (typeof ppSound !== 'undefined') ppSound.play('snap');

  // Checkmark animation on save button
  if (typeof PP !== 'undefined') {
    const saveBtn = document.getElementById('ai-save-btn');
    if (saveBtn) PP.showSaveCheck(saveBtn);
  }

  // Flash save toast inside the modal
  const toast = document.getElementById('ai-save-toast');
  if (toast) {
    toast.style.display = 'block';
    toast.classList.remove('toast-visible');
    void toast.offsetWidth;
    toast.classList.add('toast-visible');
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => { toast.style.display = 'none'; }, 400);
    }, 2600);
  }
}

/* ====================================================
   REGENERATE — same prompt, new variations
   ==================================================== */
function aiGenRegenerate() {
  if (!aiGenState.lastPrompt) return;
  if (typeof ppSound !== 'undefined') ppSound.play('shuffle');

  // Native-feel: blur out current results before regenerating
  if (typeof PP !== 'undefined') {
    const grid = document.getElementById('ai-results-grid');
    if (grid) {
      grid.style.transition = 'filter 0.2s ease, opacity 0.2s ease';
      grid.style.filter = 'blur(6px)';
      grid.style.opacity = '0.4';
    }
  }

  const input = document.getElementById('ai-prompt-input');
  if (input) input.value = aiGenState.lastPrompt;
  aiGenSubmit();
}

/* ====================================================
   IMPROVE — "Make it better" (refine current prompt)
   ==================================================== */
function aiGenImprove() {
  if (!aiGenState.lastPrompt) return;
  if (typeof ppSound !== 'undefined') ppSound.play('tick');

  // Append a quiet refinement cue — server merch engine uses it
  const refinements = ['cleaner edges', 'more detail', 'sharper contrast', 'bolder design'];
  const cue = refinements[aiGenState.genCount % refinements.length];
  aiGenState._improveHint = cue;

  const input = document.getElementById('ai-prompt-input');
  if (input) input.value = aiGenState.lastPrompt;

  aiGenShowInfo(`✦ Refining — applying "${cue}"…`);
  aiGenSubmit();
}

/* ====================================================
   VARIATION — "More like this" / "Cleaner" / "Bolder"
   ==================================================== */
function aiGenVariation(type) {
  if (!aiGenState.lastPrompt) return;
  if (typeof ppSound !== 'undefined') ppSound.play('tick');

  const styleMap = { 'like-this': null, 'cleaner': 'minimal', 'bolder': 'bold' };
  const newStyle = styleMap[type] || null;
  if (newStyle) {
    aiGenState.lastStyle = newStyle;
    document.querySelectorAll('.ai-chip[data-style]').forEach(c => {
      c.classList.toggle('ai-chip--active', c.dataset.style === newStyle);
    });
  }

  const input = document.getElementById('ai-prompt-input');
  if (input) input.value = aiGenState.lastPrompt;
  aiGenSubmit();
}

/* ====================================================
   STYLE VARIANT LOOP — appends style adjective to last prompt
   ==================================================== */
function aiStyleVariant(style) {
  // Track active style so ppBuildPrompt can apply it on every regen
  aiGenState.lastStyle = style;

  // Update active chip highlight
  document.querySelectorAll('.ai-chip[data-style]').forEach(c => {
    c.classList.toggle('ai-chip--active', c.dataset.style === style);
  });

  // Keep the input showing the raw user subject — not the style suffix
  const base  = aiGenState.lastPrompt || '';
  const input = document.getElementById('ai-prompt-input');
  if (input && base) input.value = base; // keep it clean
  aiGenSubmit();
}

/* ====================================================
   QUICK PROMPT CHIPS — fill input then auto-submit
   ==================================================== */
function aiQuickPrompt(text) {
  aiGenState.lastStyle = null; // reset style so quick chips start fresh
  // Clear any active style highlight
  document.querySelectorAll('.ai-chip[data-style]').forEach(c => c.classList.remove('ai-chip--active'));

  const input = document.getElementById('ai-prompt-input');
  if (input) {
    input.value = text;
    input.focus();
    input.classList.add('chip-fill');
    setTimeout(() => input.classList.remove('chip-fill'), 400);
  }
  aiGenSubmit();
}

function aiGenShowError(msg) {
  const box = document.getElementById('ai-error-box');
  if (!box) return;
  // Feature 12: reframe negative error language into positive guidance
  const reframed = msg
    .replace(/not print.?ready/gi,         'Almost there — quick fix needed')
    .replace(/too low[, ]*upscale required/gi, 'Almost there — tap Upscale to fix this')
    .replace(/^❌\s*/,                        '⚡ ')
    .replace(/\bfailed\b/gi,               'needs a quick fix');
  box.textContent    = reframed;
  box.style.display  = 'block';
  box.className      = 'ai-message-box error';
}

function aiGenShowInfo(msg) {
  const box = document.getElementById('ai-error-box');
  if (!box) return;
  box.textContent    = msg;
  box.style.display  = 'block';
  box.className      = 'ai-message-box info';
}

function aiGenHideError() {
  const box = document.getElementById('ai-error-box');
  if (box) box.style.display = 'none';
}

/* ====================================================
   MONEY ENGINE
   ==================================================== */

const ME_TIERS = [
  { qty: 25, pct: 20 },
  { qty: 10, pct: 10 },
];

function meGetDiscount(qty) {
  for (const t of ME_TIERS) {
    if (qty >= t.qty) return t.pct;
  }
  return 0;
}

function meNextTier(qty) {
  // Find the next tier above current qty
  for (let i = ME_TIERS.length - 1; i >= 0; i--) {
    if (qty < ME_TIERS[i].qty) return ME_TIERS[i];
  }
  return null;
}

function meShowPanel(img, printOk) {
  const panel = document.getElementById('me-panel');
  if (!panel) return;

  // Reset per-session state
  aiGenState.meQty       = 1;
  aiGenState.meEventType = null;
  aiGenState.meGroupMode = 'same';

  // Print-ready badge visibility
  const prBadge = document.getElementById('me-print-ready');
  if (prBadge) prBadge.style.display = printOk ? 'flex' : 'none';

  // Reset qty highlight
  meHighlightQtyBtn(1);
  meUpdateSavingsNudge(1);
  meUpdateOrderBtn();

  // Reset sub-sections
  ['me-event-types', 'me-group-mode', 'me-addons', 'me-reorder', 'me-share'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const eventRow = document.getElementById('me-event-row');
  if (eventRow) eventRow.style.display = 'flex';

  // Reset order button state
  const btn = document.getElementById('me-order-btn');
  if (btn) { btn.disabled = false; btn.classList.remove('me-order-confirmed'); }

  // Reset perfect line
  const line = document.getElementById('me-perfect-line');
  if (line) line.textContent = 'This would look perfect for a team, group, or event.';

  // Reset Y/N buttons
  document.querySelectorAll('.me-yn-btn').forEach(b => b.classList.remove('active'));
  // Reset event chips
  document.querySelectorAll('#me-event-types .ai-chip').forEach(c => c.classList.remove('active'));
  // Reset addon cards
  document.querySelectorAll('.me-addon-card').forEach(c => {
    c.classList.remove('me-addon-added');
    c.disabled = false;
  });

  panel.style.display = 'block';
  panel.classList.remove('me-panel-in');
  void panel.offsetWidth;
  panel.classList.add('me-panel-in');
}

function meSetQty(qty) {
  aiGenState.meQty = qty;
  meHighlightQtyBtn(qty);
  meUpdateSavingsNudge(qty);
  meUpdateOrderBtn();
  aiUpdatePrice(); // sync price strip
}

function meHighlightQtyBtn(qty) {
  document.querySelectorAll('.me-qty-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.qty) === qty);
  });
}

function meUpdateSavingsNudge(qty) {
  const el = document.getElementById('me-savings-nudge');
  if (!el) return;
  const next = meNextTier(qty);
  if (next) {
    const away = next.qty - qty;
    el.textContent = `You're ${away} away from saving ${next.pct}% — bump it up!`;
  } else {
    el.textContent = `✓ You're saving ${meGetDiscount(qty)}% — great choice!`;
  }
  el.style.display = 'block';
}

function meUpdateOrderBtn() {
  const btn = document.getElementById('me-order-btn');
  if (!btn) return;
  const qty  = aiGenState.meQty;
  const disc = meGetDiscount(qty);
  btn.textContent = disc > 0
    ? `Save Design & Order ${qty} (${disc}% off)`
    : `Save Design`;
}

function meEventYes() {
  const row   = document.getElementById('me-event-row');
  const types = document.getElementById('me-event-types');
  if (row) {
    row.querySelector('.me-yn-yes').classList.add('active');
    row.querySelector('.me-yn-no').classList.remove('active');
  }
  if (types) types.style.display = 'flex';
  if (aiGenState.meQty < 10) meSetQty(10);
}

function meEventNo() {
  const row   = document.getElementById('me-event-row');
  const types = document.getElementById('me-event-types');
  const group = document.getElementById('me-group-mode');
  if (row) {
    row.querySelector('.me-yn-no').classList.add('active');
    row.querySelector('.me-yn-yes').classList.remove('active');
  }
  if (types) types.style.display = 'none';
  if (group) group.style.display = 'none';
  aiGenState.meEventType = null;
}

function meSelectEvent(type) {
  aiGenState.meEventType = type;
  document.querySelectorAll('#me-event-types .ai-chip').forEach(c => {
    c.classList.toggle('active', c.textContent.trim() === type);
  });
  const group = document.getElementById('me-group-mode');
  if (group) group.style.display = 'block';
  if (aiGenState.meQty < 10) meSetQty(10);
  const line = document.getElementById('me-perfect-line');
  if (line) line.textContent = `Perfect for a ${type} — everyone gets the same great design.`;
}

function meGroupChange(value) {
  aiGenState.meGroupMode = value;
}

/* ====================================================
   CONVERSION — MOCKUP PREVIEW
   Draws the selected design over a flat shirt/sticker
   shape on an offscreen canvas for instant preview.
   ==================================================== */
let _mockupMode = 'shirt';

function aiMockupPreview(mode) {
  _mockupMode = mode;

  // Sync active button
  document.querySelectorAll('.ai-mockup-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mockup === mode);
  });

  const stage  = document.getElementById('ai-mockup-stage');
  const canvas = document.getElementById('ai-mockup-canvas');
  const note   = document.getElementById('ai-mockup-note');
  const img    = aiGenState.selected;

  if (!stage || !canvas || !img || mode === 'none') {
    if (stage) stage.style.display = 'none';
    return;
  }

  stage.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = mode === 'sticker' ? '#ffffff' : '#1a1c24';
  ctx.fillRect(0, 0, W, H);

  // Shape
  if (mode === 'shirt') {
    _drawShirtShape(ctx, W, H);
    if (note) note.textContent = 'Preview — chest print area shown';
  } else if (mode === 'sticker') {
    _drawStickerShape(ctx, W, H);
    if (note) note.textContent = 'Preview — die-cut sticker shape';
  }

  // Overlay design image
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    const pad = mode === 'shirt' ? 90 : 55;
    const size = W - pad * 2;
    const x = (W - size) / 2;
    const y = mode === 'shirt' ? 110 : (H - size) / 2;
    ctx.save();
    if (mode === 'shirt') {
      // Clip to chest area
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 4, size + 8, size + 8, 8);
      ctx.clip();
    }
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  };
  image.onerror = () => { if (note) note.textContent = 'Preview not available for this image.'; };
  image.src = img.url;
}

function _drawShirtShape(ctx, W, H) {
  const c = '#2a2d3a', stroke = '#444';
  ctx.save();
  ctx.fillStyle = c;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  // Simple flat shirt silhouette
  ctx.beginPath();
  ctx.moveTo(W * 0.2, H * 0.08);
  ctx.lineTo(W * 0.1, H * 0.25);
  ctx.lineTo(W * 0.18, H * 0.27);
  ctx.lineTo(W * 0.18, H * 0.9);
  ctx.lineTo(W * 0.82, H * 0.9);
  ctx.lineTo(W * 0.82, H * 0.27);
  ctx.lineTo(W * 0.9, H * 0.25);
  ctx.lineTo(W * 0.8, H * 0.08);
  ctx.quadraticCurveTo(W * 0.65, H * 0.14, W * 0.5, H * 0.15);
  ctx.quadraticCurveTo(W * 0.35, H * 0.14, W * 0.2, H * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function _drawStickerShape(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 12;
  const pad = 20;
  ctx.beginPath();
  ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, 20);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ====================================================
   CONVERSION — COMPARE MODE
   Builds A/B/C/D toggle buttons for the 4 results.
   ==================================================== */
function aiCompareUpdate() {
  const container = document.getElementById('ai-compare-btns');
  if (!container) return;
  const results = aiGenState.results;
  if (results.length < 2) { container.innerHTML = ''; return; }

  container.innerHTML = results.map((img, i) => {
    const isActive = aiGenState.selected && aiGenState.selected.url === img.url;
    const label = String.fromCharCode(65 + i); // A, B, C, D
    const qa = img._qa;
    const score = qa ? qa.qaScore : '?';
    return `<button class="ai-compare-btn${isActive ? ' active' : ''}"
      onclick="aiGenSelectResult(${i}); aiCompareUpdate();"
      title="Version ${label} — QA score: ${score}/100"
      aria-pressed="${isActive ? 'true' : 'false'}">
      ${label} <span class="ai-compare-score">${score}</span>
    </button>`;
  }).join('');
}

/* ====================================================
   CONVERSION — PRICE DISPLAY
   Shows a simple per-item price based on qty in
   the Money Engine (updates live with qty changes).
   ==================================================== */
const AI_PRICE_BASE = 12.99;  // ← set your shop's base price here

function aiUpdatePrice() {
  const el = document.getElementById('ai-price-num');
  if (!el) return;
  const qty  = aiGenState.meQty || 1;
  const disc = meGetDiscount(qty);
  const price = disc > 0
    ? (AI_PRICE_BASE * (1 - disc / 100)).toFixed(2)
    : AI_PRICE_BASE.toFixed(2);
  el.textContent = `$${price}`;
  // Update the unit label with qty context
  const unit = document.querySelector('.ai-price-unit');
  if (unit) {
    unit.textContent = qty > 1 ? `per shirt (${qty} total — ${disc}% off)` : 'per shirt';
  }
}

/* ====================================================
   CONVERSION — SEND TO PRINT + REDIRECT SYSTEM
   Features 10, 13, 14
   ==================================================== */

// Print shop partner — blendedprints.com
const PRINT_SHOP_URL = 'https://blendedprints.com/order';

async function aiSendToPrint() {
  const img = aiGenState.selected;
  if (!img) return;

  // Fix 9: Hide install card so it doesn't clash with the print overlay
  if (typeof ppHideInstallCard === 'function') ppHideInstallCard();

  // Feature 13: Final confirmation overlay
  const confirm = document.getElementById('ai-final-confirm');
  const fill    = document.getElementById('ai-final-bar-fill');
  if (confirm) {
    confirm.style.display = 'flex';
    // Animate the progress bar
    if (fill) {
      fill.style.width = '0%';
      requestAnimationFrame(() => {
        fill.style.transition = 'width 2s ease';
        fill.style.width = '100%';
      });
    }
    if (typeof ppSound !== 'undefined') ppSound.play('ding');
  }

  // Save before redirecting
  saveAiDesign(img);
  meAutoSaveState();

  // Fix 8: Shorter delay + show redirecting feedback
  const finalSub = document.querySelector('#ai-final-confirm .ai-final-sub');
  if (finalSub) {
    setTimeout(() => { finalSub.textContent = 'Redirecting…'; }, 900);
  }
  await new Promise(r => setTimeout(r, 1400));

  const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
  ppSendToPrintShop(img.url, sizePreset.inches + '"', aiGenState.meQty || 1);
}

/**
 * ppSendToPrintShop(imageUrl, size, qty)
 * Redirects to the external print shop with order parameters.
 * Swap PRINT_SHOP_URL above for your shop's endpoint.
 */
function ppSendToPrintShop(imageUrl, size, qty) {
  const params = new URLSearchParams({
    image: imageUrl,
    size:  size,
    qty:   qty,
    ref:   'printpath',
  });
  // Log for analytics (Feature 15)
  console.log('[PrintPath] Send to Print:', { imageUrl, size, qty });
  try {
    localStorage.setItem('pp-last-handoff', JSON.stringify({
      imageUrl, size, qty, prompt: aiGenState.lastPrompt,
      sentAt: new Date().toISOString(),
    }));
  } catch (_) {}
  window.open(`${PRINT_SHOP_URL}?${params.toString()}`, '_blank', 'noopener');

  // Hide confirmation overlay
  const confirm = document.getElementById('ai-final-confirm');
  if (confirm) confirm.style.display = 'none';
}

function meAddToCart() {
  const img = aiGenState.selected;
  if (!img) return;

  saveAiDesign(img);
  meAutoSaveState();

  // Show add-ons
  const addons = document.getElementById('me-addons');
  if (addons) {
    addons.style.display = 'block';
    addons.classList.remove('me-panel-in');
    void addons.offsetWidth;
    addons.classList.add('me-panel-in');
  }

  // Show reorder panel
  const reorder = document.getElementById('me-reorder');
  if (reorder) {
    reorder.style.display = 'block';
    reorder.classList.remove('me-panel-in');
    void reorder.offsetWidth;
    reorder.classList.add('me-panel-in');
  }

  // Show share panel
  ppShowSharePanel();

  // Confirm state on button
  const btn = document.getElementById('me-order-btn');
  if (btn) {
    btn.textContent = `✓ ${aiGenState.meQty} × Design Saved`;
    btn.classList.add('me-order-confirmed');
    btn.disabled = true;
  }

  if (typeof showToast === 'function') {
    const disc = meGetDiscount(aiGenState.meQty);
    const msg  = disc > 0
      ? `🎉 ${aiGenState.meQty} × locked at ${disc}% off — sent to print queue!`
      : `✅ Design locked — ${aiGenState.meQty} × ready to print!`;
    showToast(msg, 'success');
  }
}

function meImproveDesign() {
  const panel = document.getElementById('me-panel');
  if (panel) panel.style.display = 'none';
  aiGenRegenerate();
}

function meAddon(type) {
  const labels = { stickers: 'Matching Stickers', hoodie: 'Hoodie Version', digital: 'Digital Download' };
  document.querySelectorAll('.me-addon-card').forEach(c => {
    if (c.getAttribute('onclick') && c.getAttribute('onclick').includes(`'${type}'`)) {
      c.classList.add('me-addon-added');
      c.querySelector('.me-addon-name').textContent = `✓ ${labels[type]} Added`;
      c.disabled = true;
    }
  });
  if (typeof showToast === 'function') {
    showToast(`✅ ${labels[type]} added to your order!`, 'success');
  }
}

/* ---- Auto-save & return hook ---- */
const ME_SAVE_KEY = 'pp-last-design';

function meAutoSaveState() {
  try {
    localStorage.setItem(ME_SAVE_KEY, JSON.stringify({
      url:     aiGenState.selected ? aiGenState.selected.url : null,
      prompt:  aiGenState.lastPrompt,
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
}

function meCheckReturnUser() {
  try {
    const raw = localStorage.getItem(ME_SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.prompt) return;

    const banner = document.getElementById('return-banner');
    const text   = document.getElementById('return-banner-text');
    if (!banner) return;

    const label = data.prompt.length > 50 ? data.prompt.slice(0, 50) + '…' : data.prompt;
    if (text) text.textContent = `Your design is waiting — "${label}". Pick up where you left off.`;
    banner.style.display = 'flex';
  } catch (_) {}
}

function meOpenSavedDesign() {
  const banner = document.getElementById('return-banner');
  if (banner) banner.style.display = 'none';
  try {
    const raw  = localStorage.getItem(ME_SAVE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.prompt) {
      openAiGenWithPrompt(data.prompt);
    } else {
      openAiGen();
    }
  } catch (_) {
    openAiGen();
  }
}

/* ====================================================
   SHARE SYSTEM
   ==================================================== */
const PP_SHARE_KEY = 'pp-shared-design';

/**
 * Generate a unique share ID from the current prompt + timestamp.
 * Stored in localStorage so the same page can reconstruct the design.
 */
function ppGenerateShareId(prompt, imgUrl) {
  const id = 'ppd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  try {
    // Store a map of share IDs → design data
    const raw  = localStorage.getItem(PP_SHARE_KEY) || '{}';
    const map  = JSON.parse(raw);
    map[id]    = { prompt, imgUrl, savedAt: new Date().toISOString() };
    // Keep only last 50 shared designs to avoid overflowing localStorage
    const keys = Object.keys(map);
    if (keys.length > 50) {
      keys.sort((a, b) => (map[a].savedAt < map[b].savedAt ? -1 : 1));
      keys.slice(0, keys.length - 50).forEach(k => delete map[k]);
    }
    localStorage.setItem(PP_SHARE_KEY, JSON.stringify(map));
  } catch (_) {}
  return id;
}

/**
 * Build the shareable URL for the current design.
 * Pattern: <origin><pathname>?ppshare=<id>
 */
function ppBuildShareUrl(shareId) {
  const base = window.location.origin + window.location.pathname;
  return base + '?ppshare=' + encodeURIComponent(shareId);
}

/**
 * Show the share panel after an order is confirmed, populating
 * the link input with a freshly generated unique URL.
 */
function ppShowSharePanel() {
  const img    = aiGenState.selected;
  const prompt = aiGenState.lastPrompt || '';
  const imgUrl = img ? img.url : '';

  const id  = ppGenerateShareId(prompt, imgUrl);
  const url = ppBuildShareUrl(id);

  const input = document.getElementById('me-share-link-input');
  if (input) input.value = url;

  const panel = document.getElementById('me-share');
  if (!panel) return;
  panel.style.display = 'block';
  panel.classList.remove('me-panel-in');
  void panel.offsetWidth;
  panel.classList.add('me-panel-in');

  // Reset copy confirmation
  const msg = document.getElementById('me-share-copied-msg');
  if (msg) msg.style.display = 'none';
  const copyBtn = document.getElementById('me-share-copy-btn');
  if (copyBtn) { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }
}

/**
 * Copy share link to clipboard.
 */
function ppCopyShareLink() {
  const input   = document.getElementById('me-share-link-input');
  const copyBtn = document.getElementById('me-share-copy-btn');
  const msg     = document.getElementById('me-share-copied-msg');
  if (!input || !input.value) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(() => {
        _ppShowCopied(copyBtn, msg);
      }).catch(() => _ppFallbackCopy(input, copyBtn, msg));
    } else {
      _ppFallbackCopy(input, copyBtn, msg);
    }
  } catch (_) {
    _ppFallbackCopy(input, copyBtn, msg);
  }
}

function _ppFallbackCopy(input, copyBtn, msg) {
  input.select();
  try { document.execCommand('copy'); } catch (_) {}
  _ppShowCopied(copyBtn, msg);
}

function _ppShowCopied(copyBtn, msg) {
  if (copyBtn) { copyBtn.textContent = '✔ Copied'; copyBtn.classList.add('copied'); }
  if (msg)     msg.style.display = 'block';
  if (typeof showToast === 'function') showToast('🔗 Link copied! Send it to your group.', 'success');
  // Reset after 3 s
  setTimeout(() => {
    if (copyBtn) { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }
    if (msg)     msg.style.display = 'none';
  }, 3000);
}

/**
 * Share the design via the Web Share API or fall back to copy.
 * mode: 'native' | 'message'
 */
function ppShareDesign(mode) {
  const input  = document.getElementById('me-share-link-input');
  const url    = input ? input.value : window.location.href;
  const prompt = aiGenState.lastPrompt || 'my design';
  const text   = `Check out this design I made on PrintPath — "${prompt}" 👕`;

  if (mode === 'native' && navigator.share) {
    navigator.share({ title: 'PrintPath Design', text, url }).catch(() => {});
    return;
  }

  // Fallback: build an SMS/message link (opens native messaging on mobile,
  // falls back to a copy prompt on desktop)
  if (mode === 'message') {
    const smsUrl = 'sms:?&body=' + encodeURIComponent(text + '\n' + url);
    const win    = window.open(smsUrl, '_blank');
    // If the browser blocked the window, just copy the link instead
    if (!win) ppCopyShareLink();
    return;
  }

  // Last resort: just copy
  ppCopyShareLink();
}

/**
 * On page load: check for ?ppshare= in the URL.
 * If found, look up the design in localStorage and auto-open the AI gen
 * modal with that prompt, showing a "Shared Design" notice.
 */
function ppCheckSharedLink() {
  try {
    const params  = new URLSearchParams(window.location.search);
    const shareId = params.get('ppshare');
    if (!shareId) return;

    const raw  = localStorage.getItem(PP_SHARE_KEY) || '{}';
    const map  = JSON.parse(raw);
    const data = map[shareId];

    if (!data || !data.prompt) {
      // Share ID not found in this browser — show a generic "design shared" notice
      if (typeof showToast === 'function') {
        showToast('🔗 Someone shared a PrintPath design with you — start creating!', 'info');
      }
      setTimeout(openAiGen, 500);
      return;
    }

    // Show a friendly banner
    if (typeof showToast === 'function') {
      const label = data.prompt.length > 50 ? data.prompt.slice(0, 50) + '…' : data.prompt;
      showToast(`🔗 Shared design loaded — "${label}". Make it yours!`, 'success');
    }
    setTimeout(() => openAiGenWithPrompt(data.prompt), 500);
  } catch (_) {}
}

/* ====================================================
   PRINT COLOR TOOLKIT
   ==================================================== */

/** Color toolkit state */
const ppCtState = {
  mode:       'light',         // 'light' | 'dark' | 'sticker'
  limit:      2,               // 1–4 colors
  palette:    ['#111111', '#FFFFFF'],  // active selected colors
  lastCustom: '#111111',
};

/** Print-safe contrast ratios (WCAG relative luminance) */
function _ppCtLuminance(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const to = c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  return 0.2126*to(r) + 0.7152*to(g) + 0.0722*to(b);
}

function _ppCtContrast(hex1, hex2) {
  const l1 = _ppCtLuminance(hex1);
  const l2 = _ppCtLuminance(hex2);
  const bright = Math.max(l1, l2);
  const dark   = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

/** Background color implied by the current fabric mode */
function _ppCtBgColor() {
  return ppCtState.mode === 'dark' ? '#111111' : '#FFFFFF';
}

/** Show the toolkit panel */
function ppCtShow() {
  const panel = document.getElementById('pp-color-toolkit');
  if (!panel) return;
  panel.style.display = 'block';
  panel.classList.remove('me-panel-in');
  void panel.offsetWidth;
  panel.classList.add('me-panel-in');
  ppCtRenderPalette();
  ppCtCheckContrast();
}

/** Hide toolkit (called on new generation) */
function ppCtHide() {
  const panel = document.getElementById('pp-color-toolkit');
  if (panel) panel.style.display = 'none';
}

/** Set fabric mode */
function ppCtSetMode(mode) {
  ppCtState.mode = mode;

  // Update button states
  document.querySelectorAll('.pp-ct-mode-btn').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('pp-ct-mode-active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  // Show / hide cut-line preview for sticker mode
  const cutWrap = document.getElementById('pp-ct-cutline-wrap');
  if (cutWrap) cutWrap.style.display = mode === 'sticker' ? 'block' : 'none';

  ppCtCheckContrast();

  // Propagate mode hint into next prompt
  const modeHints = {
    light:   'on a light shirt',
    dark:    'on a dark shirt',
    sticker: 'sticker design with white border and cut line',
  };
  ppCtState._modeHint = modeHints[mode] || '';
}

/** Set color limit */
function ppCtSetLimit(n) {
  ppCtState.limit = n;

  document.querySelectorAll('.pp-ct-limit-btn').forEach(b => {
    const active = parseInt(b.dataset.limit) === n;
    b.classList.toggle('pp-ct-limit-active', active);
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const label = document.getElementById('pp-ct-count-label');
  if (label) label.textContent = n === 1 ? '1 color' : `${n} colors`;

  // Trim palette to new limit
  if (ppCtState.palette.length > n) {
    ppCtState.palette = ppCtState.palette.slice(0, n);
    ppCtRenderPalette();
    ppCtCheckContrast();
  }
}

/** Pick a preset swatch */
function ppCtPickPreset(hex, name) {
  _ppCtAddColor(hex);

  // Pulse the swatch
  document.querySelectorAll('.pp-ct-swatch').forEach(s => {
    s.classList.toggle('pp-ct-swatch--active', s.dataset.color === hex);
  });
}

/** Update custom color hex label as user drags picker */
function ppCtCustomColor(hex) {
  ppCtState.lastCustom = hex;
  const label = document.getElementById('pp-ct-custom-label');
  if (label) label.textContent = hex.toUpperCase();
}

/** Add custom color to active palette */
function ppCtAddCustom() {
  _ppCtAddColor(ppCtState.lastCustom);
}

/** Internal: add a color to the palette (respects limit) */
function _ppCtAddColor(hex) {
  hex = hex.toUpperCase();
  // Dedupe
  if (ppCtState.palette.includes(hex)) {
    if (typeof showToast === 'function') showToast('Color already in palette.', 'info');
    return;
  }
  if (ppCtState.palette.length >= ppCtState.limit) {
    // Replace the last color
    ppCtState.palette[ppCtState.palette.length - 1] = hex;
  } else {
    ppCtState.palette.push(hex);
  }
  ppCtRenderPalette();
  ppCtCheckContrast();
  ppCtShowSafeBadge();
}

/** Render the active palette swatches */
function ppCtRenderPalette() {
  const container = document.getElementById('pp-ct-active-palette');
  if (!container) return;

  const count = document.getElementById('pp-ct-palette-count');
  if (count) count.textContent = `${ppCtState.palette.length} / ${ppCtState.limit}`;

  container.innerHTML = ppCtState.palette.map((hex, i) => `
    <div class="pp-ct-active-swatch" style="background:${hex}" title="${hex}">
      <span class="pp-ct-swatch-hex">${hex}</span>
      <button class="pp-ct-remove-swatch" onclick="ppCtRemoveColor(${i})"
              aria-label="Remove ${hex}">×</button>
    </div>
  `).join('');
}

/** Remove a color from the active palette */
function ppCtRemoveColor(index) {
  ppCtState.palette.splice(index, 1);
  ppCtRenderPalette();
  ppCtCheckContrast();
}

/**
 * Contrast check: compare each palette color against the implied
 * fabric background. Warn if any pair is below 3:1 (WCAG AA Large).
 */
function ppCtCheckContrast() {
  const bg     = _ppCtBgColor();
  const warn   = document.getElementById('pp-ct-contrast-warn');
  const msg    = document.getElementById('pp-ct-contrast-msg');
  if (!warn) return;

  const low = ppCtState.palette.filter(c => {
    try { return _ppCtContrast(c, bg) < 3; } catch(_) { return false; }
  });

  if (low.length > 0) {
    const names = low.join(', ');
    if (msg) msg.textContent =
      `Low contrast on ${ppCtState.mode} fabric: ${names}. May be hard to read.`;
    warn.style.display = 'flex';
  } else {
    warn.style.display = 'none';
    ppCtShowSafeBadge();
  }
}

/**
 * Auto-fix: nudge low-contrast colors toward a print-safe version.
 * Dark-mode fabric → lighten; light-mode fabric → darken.
 */
function ppCtAutoFix() {
  const bg = _ppCtBgColor();
  ppCtState.palette = ppCtState.palette.map(hex => {
    try {
      if (_ppCtContrast(hex, bg) >= 3) return hex;
      // Parse and shift lightness
      let r = parseInt(hex.slice(1,3),16);
      let g = parseInt(hex.slice(3,5),16);
      let b = parseInt(hex.slice(5,7),16);
      const shift = ppCtState.mode === 'dark' ? 60 : -60;
      r = Math.max(0, Math.min(255, r + shift));
      g = Math.max(0, Math.min(255, g + shift));
      b = Math.max(0, Math.min(255, b + shift));
      return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('').toUpperCase();
    } catch(_) { return hex; }
  });
  ppCtRenderPalette();
  ppCtCheckContrast();
  if (typeof showToast === 'function') showToast('✅ Colors auto-adjusted for print contrast.', 'success');
}

/** Flash the print-safe badge */
function ppCtShowSafeBadge() {
  const badge = document.getElementById('pp-ct-safe-badge');
  if (!badge) return;
  badge.classList.remove('pp-ct-badge-pop');
  void badge.offsetWidth;
  badge.classList.add('pp-ct-badge-pop');
}

/**
 * Apply active colors + mode to the next prompt and regenerate.
 * Appends color and mode context to ppBuildPrompt via aiGenState.
 */
function ppCtApplyToDesign() {
  if (!aiGenState.lastPrompt) return;

  // Build color instruction
  const colorNames = ppCtState.palette.join(', ');
  const modeHint   = ppCtState._modeHint || '';
  const colorNote  = `Colors: ${colorNames}. Limit to ${ppCtState.limit} colors only. ${modeHint}`.trim();

  // Temporarily override the style note by stashing in state
  aiGenState._ctColorNote = colorNote;

  // Reset chip highlight — color toolkit is taking over style direction
  aiGenState.lastStyle = null;

  const input = document.getElementById('ai-prompt-input');
  if (input) input.value = aiGenState.lastPrompt;

  if (typeof showToast === 'function') showToast('🎨 Applying colors to new design…', 'info');
  aiGenSubmit();

  // Clear after one use
  setTimeout(() => { aiGenState._ctColorNote = null; }, 100);
}

/* ====================================================
   REORDER SYSTEM
   ==================================================== */
function meReorder(type) {
  const labels = {
    same:     'Reorder same design',
    stickers: 'Make matching stickers',
    color:    'Change color & reorder',
    event:    'Duplicate for another event',
  };

  // Mark button as actioned
  document.querySelectorAll('.me-reorder-btn').forEach(b => {
    if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(`'${type}'`)) {
      b.classList.add('me-reorder-active');
      b.querySelector('span:last-child').textContent = `✓ ${labels[type]}`;
    }
  });

  if (type === 'same') {
    // Reset panel, scroll to results
    const panel = document.getElementById('me-panel');
    if (panel) {
      panel.style.display = 'none';
      setTimeout(() => {
        const grid = document.getElementById('ai-results-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
    meSetQty(aiGenState.meQty);
    if (typeof showToast === 'function') showToast('↻ Ready to reorder — review your design and lock again.', 'info');

  } else if (type === 'stickers') {
    if (aiGenState.selected && typeof openStickerLab === 'function') {
      closeAiGen();
      setTimeout(() => openStickerLab(), 150);
    }

  } else if (type === 'color') {
    const prompt = aiGenState.lastPrompt;
    if (prompt) {
      const input = document.getElementById('ai-prompt-input');
      if (input) input.value = prompt + ' — different color';
      aiGenRegenerate();
    }

  } else if (type === 'event') {
    // Reset event fields and scroll to event row
    meEventNo();
    const eventRow = document.getElementById('me-event-row');
    if (eventRow) eventRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof showToast === 'function') showToast('📋 Pick a new event type and lock your order.', 'info');
  }
}

/* ====================================================
   PRICING TIER SELECTION (homepage three-tier)
   ==================================================== */
function ppSelectTier(tier, qty) {
  // Highlight selected card
  document.querySelectorAll('.pricing-card').forEach(c => c.classList.remove('pricing-selected'));
  const map = { starter: 'pricing-card--starter', popular: 'pricing-card--popular', event: 'pricing-card--event' };
  const card = document.querySelector('.' + map[tier]);
  if (card) card.classList.add('pricing-selected');

  // Open AI gen with qty pre-set in ME panel
  openAiGen();

  // After modal opens, set the qty
  requestAnimationFrame(() => {
    if (typeof meSetQty === 'function') meSetQty(qty);
  });

  // Show dynamic nudge on pricing section
  const nudge = document.getElementById('pricing-nudge');
  if (nudge) {
    const disc = meGetDiscount(qty);
    if (disc > 0) {
      nudge.textContent = `✓ ${disc}% savings unlocked at ${qty} items`;
    } else {
      const next = meNextTier(qty);
      nudge.textContent = next ? `Add ${next.qty - qty} more to save ${next.pct}%` : '';
    }
    nudge.style.display = nudge.textContent ? 'block' : 'none';
  }
}

function ppOpenPro() {
  // Pro plan — route to AI design lab until payment is wired
  openAiGen();
  if (typeof showToast === 'function') {
    showToast('✨ Pro features unlock automatically — design first, upgrade in-app soon.', 'info');
  }
}

/* ====================================================
   KEYBOARD & EVENT BINDING (called once on DOMContentLoaded)
   ==================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Prompt — submit on Enter
  const input = document.getElementById('ai-prompt-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        aiGenSubmit();
      }
    });
  }

  // Close on overlay backdrop click
  const overlay = document.getElementById('ai-gen-overlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeAiGen();
    });
  }

  // Close button
  const closeBtn = document.getElementById('ai-gen-close');
  if (closeBtn) closeBtn.addEventListener('click', closeAiGen);

  // ── Server Connection Panel ─────────────────────────────────
  const settingsToggle = document.getElementById('ai-settings-toggle');
  const settingsPanel  = document.getElementById('ai-settings-panel');
  const keyStatus      = document.getElementById('ai-key-status');
  const serverCheckBtn = document.getElementById('ai-server-check');

  if (settingsToggle && settingsPanel) {
    // Toggle panel visibility
    settingsToggle.addEventListener('click', () => {
      const visible = settingsPanel.style.display !== 'none';
      settingsPanel.style.display = visible ? 'none' : 'block';
      if (!visible) ppUpdateKeyStatus();
    });
  }

  if (serverCheckBtn && typeof ppOpenAI !== 'undefined') {
    serverCheckBtn.addEventListener('click', async () => {
      keyStatus.innerHTML = '<span class="ai-ks-inactive">⟳ Checking…</span>';
      keyStatus.style.display = 'block';
      await ppOpenAI.checkServer();
      ppUpdateKeyStatus();
    });
  }

  function ppUpdateKeyStatus() {
    if (!keyStatus || typeof ppOpenAI === 'undefined') return;
    const online = ppOpenAI.isOnline();
    if (online === true) {
      keyStatus.innerHTML = '<span class="ai-ks-active">✓ Connected</span> — prompts will be cleaned via AI';
      keyStatus.style.display = 'block';
      if (settingsToggle) settingsToggle.classList.add('ai-settings-active');
    } else if (online === false) {
      keyStatus.innerHTML = '<span class="ai-ks-inactive">✗ Offline</span> — using local processing. Start the server and try again.';
      keyStatus.style.display = 'block';
      if (settingsToggle) settingsToggle.classList.remove('ai-settings-active');
    } else {
      keyStatus.innerHTML = '<span class="ai-ks-inactive">○ Not checked</span> — tap Check Connection';
      keyStatus.style.display = 'block';
      if (settingsToggle) settingsToggle.classList.remove('ai-settings-active');
    }
  }

  // Auto-check server on load (non-blocking)
  if (typeof ppOpenAI !== 'undefined') {
    ppOpenAI.checkServer().then(() => {
      if (ppOpenAI.isOnline() && settingsToggle) {
        settingsToggle.classList.add('ai-settings-active');
      }
    });
  }
  // ────────────────────────────────────────────────────────────

  // Generate button
  const genBtn = document.getElementById('ai-generate-btn');
  if (genBtn) genBtn.addEventListener('click', aiGenSubmit);

  // Upscale button
  const upscaleBtn = document.getElementById('ai-upscale-btn');
  if (upscaleBtn) upscaleBtn.addEventListener('click', aiGenUpscale);

  // Send to Sticker Lab
  const stickerBtn = document.getElementById('ai-to-sticker-btn');
  if (stickerBtn) stickerBtn.addEventListener('click', aiGenSendToStickerLab);

  // Send to Design Lab
  const designBtn = document.getElementById('ai-to-design-btn');
  if (designBtn) designBtn.addEventListener('click', aiGenSendToDesignLab);

  // Regenerate button
  const regenBtn = document.getElementById('ai-regen-btn');
  if (regenBtn) regenBtn.addEventListener('click', aiGenRegenerate);

  // Save design button
  const saveBtn = document.getElementById('ai-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', aiGenSaveDesign);

  // Return hook — show banner if user has a saved design
  meCheckReturnUser();

  // Shared-link auto-load — open design if ?ppshare= is in the URL
  ppCheckSharedLink();
});

/* ============================================================
   HOMEPAGE ENTRY — pre-fill prompt and open AI Gen modal.
   Called from the Design Lab entry section on the homepage.
   ============================================================ */
function openAiGenWithPrompt(promptText) {
  openAiGen();
  aiGenState.lastStyle = null; // fresh open — no style pre-set
  // Clear any active style chip highlight
  document.querySelectorAll('.ai-chip[data-style]').forEach(c => c.classList.remove('ai-chip--active'));
  const input = document.getElementById('ai-prompt-input');
  if (input && promptText && promptText.trim()) {
    input.value = promptText.trim();
    requestAnimationFrame(() => aiGenSubmit());
  }
}
