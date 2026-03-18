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
  serverUrl:       '',
  generatePath:    '/generate-image',
  upscalePath:     '/upscale-image',

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
 * Checks for scene keywords in API-returned metadata.
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
async function generateDesign(prompt, negativePrompt) {
  const endpoint = AI_GEN_CONFIG.serverUrl + AI_GEN_CONFIG.generatePath;

  let res;
  try {
    res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ prompt }),
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
    url:      img.url,
    prompt,
    dpi:      img.dpi || AI_GEN_CONFIG.apiOutputDpi,
    widthPx:  img.width  || AI_GEN_CONFIG.apiOutputPx,
    heightPx: img.height || AI_GEN_CONFIG.apiOutputPx,
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
  const endpoint = AI_GEN_CONFIG.serverUrl + AI_GEN_CONFIG.upscalePath;

  let res;
  try {
    res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:    imageObj.url,
        width:  imageObj.widthPx,
        height: imageObj.heightPx,
      }),
    });
  } catch (networkErr) {
    throw new Error('Cannot reach the PrintPath server. Is it running?');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Upscale failed (${res.status})`);
  }

  const data = await res.json();
  return {
    url:      data.url      || imageObj.url,
    dpi:      data.dpi      || imageObj.dpi * 2,
    widthPx:  data.width    || imageObj.widthPx  * 2,
    heightPx: data.height   || imageObj.heightPx * 2,
    upscaled: true,
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
      // Place cursor at end if there's already text
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 80);
  }
}

function closeAiGen() {
  const overlay = document.getElementById('ai-gen-overlay');
  if (!overlay) return;
  aiGenState.open = false;

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

    const badgeLabel = check.ok ? 'Print Ready' : check.grade === 'warn' ? 'Upscale Rec.' : 'Needs Upscale';

    return `
      <div class="ai-result-card${selected ? ' selected' : ''}${isBest ? ' best-match' : ''}"
           onclick="aiGenSelectResult(${i})"
           role="button" tabindex="0"
           aria-label="Generated design ${i + 1}${isBest ? ' — best match' : ''}"
           onkeydown="if(event.key==='Enter'||event.key===' ')aiGenSelectResult(${i})">
        ${isBest ? '<div class="ai-best-label">Recommended</div>' : ''}
        <div class="ai-result-img-wrap">
          <img src="${img.url}" alt="Generated design ${i + 1}" class="ai-result-img"
               loading="lazy" crossorigin="anonymous"
               onload="this.closest('.ai-result-card').classList.add('loaded');this.nextElementSibling.style.display='none'"
               onerror="this.closest('.ai-result-card').classList.add('load-error');this.nextElementSibling.style.display='none'" />
          <div class="ai-result-loading-overlay">
            <div class="ai-spinner-sm"></div>
          </div>
        </div>
        <div class="ai-result-meta">
          <span class="ai-dpi-badge ${check.grade}">${badgeLabel}</span>
          <span class="ai-dpi-num">${check.dpi} DPI · ${img.widthPx}px</span>
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

  const check = ppDpiReadout(img);

  // Legacy badge — keep for screen readers / compact view
  const badge = document.getElementById('ai-action-badge');
  if (badge) {
    if (check.ok) {
      badge.textContent = '✅ Print Ready — 300 DPI';
      badge.className   = 'ai-action-badge pass';
      badge.classList.remove('glow-pop');
      void badge.offsetWidth;
      badge.classList.add('glow-pop');
      if (typeof ppSound !== 'undefined') ppSound.play('ding');
    } else {
      badge.textContent = `⚠️ ${check.dpi} DPI — upscale for print`;
      badge.className   = 'ai-action-badge warn';
    }
  }

  // Show/hide upscale button
  const upscaleBtn = document.getElementById('ai-upscale-btn');
  if (upscaleBtn) upscaleBtn.style.display = check.ok ? 'none' : 'inline-flex';

  // Show the color toolkit
  ppCtShow();

  // Show the money engine panel
  meShowPanel(img, check.ok);
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

  // Hide old results, layout badge, and panels — show spinner
  const grid = document.getElementById('ai-results-grid');
  if (grid) grid.innerHTML = '';
  const badge = document.getElementById('pp-layout-badge');
  if (badge) badge.style.display = 'none';
  const bar  = document.getElementById('ai-action-bar');
  if (bar) bar.style.display = 'none';
  const mePanel = document.getElementById('me-panel');
  if (mePanel) mePanel.style.display = 'none';
  // Hide color toolkit until a new design is selected
  ppCtHide();
  if (typeof ppSound !== 'undefined') ppSound.play('tick');
  aiGenSetLoading(true);

  try {
    // Pass enforced prompt + negative prompt to the generator.
    // generateDesign() currently uses the prompt as a seed for placeholders;
    // when you wire a real API, pass PP_NEGATIVE_PROMPT as `negative_prompt`.
    const results = await generateDesign(enforcedPrompt, PP_NEGATIVE_PROMPT);

    // ── Fail detection ──────────────────────────────────────────
    // Check if any result looks like it contains a scene / wrong subject.
    // On the first failure, silently regenerate once with extra emphasis.
    const failCount = results.filter(r => ppDetectFailure(r, rawPrompt)).length;
    if (failCount > results.length / 2 && aiGenState.genCount < 99) {
      // More than half look wrong — auto-regen with stronger subject emphasis
      const retryPrompt = ppBuildPrompt(`ONLY a ${ppSanitizeInput(rawPrompt)}, nothing else`, aiGenState.lastStyle);
      const retryResults = await generateDesign(retryPrompt, PP_NEGATIVE_PROMPT);
      aiGenState.results = retryResults;
      aiGenShowInfo('✦ Auto-refined — showing improved results.');
    } else {
      aiGenState.results = results;
    }
    // ────────────────────────────────────────────────────────────

    // Show layout badge with auto-selected layout/palette details
    ppUpdateLayoutBadge(aiGenState._lastAnalysis);

    aiGenRenderResults();

    // Native-feel: stagger card entrance animation
    if (typeof PP !== 'undefined') {
      const grid = document.getElementById('ai-results-grid');
      if (grid) PP.staggerResultCards(grid);
    }

    if (typeof ppSound !== 'undefined') ppSound.play('whoosh');
  } catch (err) {
    console.error('[PrintPath AI Gen]', err);
    aiGenShowError('Generation failed — try a different description.');
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
      aiGenState.results[idx] = Object.assign({}, aiGenState.results[idx], upscaled);
      aiGenState.selected     = aiGenState.results[idx];
    }

    aiGenRenderResults();
    aiGenShowActionBar(aiGenState.selected);

    const sizePreset = AI_GEN_CONFIG.printSizes[aiGenState.selectedSizeIdx];
    const check      = ppDpiCheck(aiGenState.selected.widthPx, sizePreset.inches);
    if (check.ok) {
      aiGenShowInfo('✓ Upscale complete — design is now print-ready!');
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

  saveAiDesign(img);
  closeAiGen();

  // Open Design Lab with the first available product that supports it,
  // or open the Design Lab nav button's target product
  if (typeof state !== 'undefined' && state.products && state.products.length > 0) {
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
  } else {
    if (typeof showToast === 'function') {
      showToast('Open a product first, then apply the AI design.', 'info');
    }
  }
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

  if (btn) {
    btn.disabled    = on;
    btn.textContent = on ? 'Creating…' : 'Create Design';
  }
  if (spinner) spinner.style.display = on ? 'flex' : 'none';
  if (hint)    hint.style.display    = on ? 'none' : (aiGenState.results.length ? 'none' : 'block');
  if (regenBar && !on && aiGenState.results.length > 0) regenBar.style.display = 'flex';

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
  box.textContent    = msg;
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
    ? `Lock Design & Order ${qty} (${disc}% off)`
    : `Lock Design & Order ${qty}`;
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
    btn.textContent = `✓ ${aiGenState.meQty} × Design Locked`;
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
  if (typeof showToast === 'function') {
    showToast('✨ PrintPath Pro — coming soon! You\'ll be first to know.', 'info');
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
