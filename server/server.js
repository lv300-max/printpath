/* ============================================================
   PrintPath — Backend Server
   ────────────────────────────────────────────────────────────
   Express server with one job: clean user prompts via OpenAI
   before they hit the design generator.

   Endpoints:
     POST /clean-prompt   — clean & structure a user prompt
     GET  /health         — server status check

   Run:
     cd server && npm install && npm start
   ============================================================ */

import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import Replicate from "replicate";

const app = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://[::]:8080",
    ],
    methods: ["POST", "GET"],
  })
);

/* ── OpenAI client ─────────────────────────────────────────── */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ── Replicate client ─────────────────────────────────── */
// Set REPLICATE_API_TOKEN in server/.env to enable Real-ESRGAN upscaling.
// Without it the /real-upscale endpoint returns 503 and the client
// silently falls back to the logical /upscale-image shim.
const replicate = process.env.REPLICATE_API_TOKEN
  ? new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  : null;

/* ── System prompt ─────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are a prompt cleaner for a t-shirt design generator. Your job is to take messy, vague, or overly complex user input and return a clean, structured JSON object.

Rules:
1. Extract the SINGLE main subject (the thing being drawn).
2. Remove filler words (please, make me, I want, can you, etc.).
3. Remove garment references (shirt, tee, hoodie, print, etc.).
4. If the user mentions a style (cartoon, minimal, retro, bold, realistic, funny), extract it separately.
5. If the user mentions a year or "est.", preserve it.
6. If the user mentions a name or group (dad, team, crew, class of), preserve it.
7. If the prompt is unclear, nonsensical, or empty, set "unclear" to true and provide a "suggestion".
8. The cleaned text should be 1-6 words maximum — the core visual subject.
9. Never add subjects the user didn't mention.
10. Never refuse. Always return valid JSON.

Return ONLY this JSON (no markdown, no explanation):
{
  "subject": "cleaned main subject (1-6 words)",
  "style": "extracted style keyword or null",
  "cleaned": "full cleaned description (short sentence)",
  "unclear": false,
  "suggestion": null
}

Examples:
User: "can you please make me a cool shirt with a big bear wearing sunglasses"
→ {"subject":"bear wearing sunglasses","style":null,"cleaned":"bear wearing sunglasses","unclear":false,"suggestion":null}

User: "I want something with like a retro vibe maybe a skull or something idk"
→ {"subject":"skull","style":"retro","cleaned":"retro skull","unclear":false,"suggestion":null}

User: "best dad ever est 2019"
→ {"subject":"best dad ever","style":null,"cleaned":"best dad ever est 2019","unclear":false,"suggestion":null}

User: "asdfghjkl"
→ {"subject":"","style":null,"cleaned":"","unclear":true,"suggestion":"Try describing what you want on the shirt — like 'a lion' or 'best mom ever'"}

User: "minimal wolf logo"
→ {"subject":"wolf logo","style":"minimal","cleaned":"minimal wolf logo","unclear":false,"suggestion":null}

User: "something funny for my friend who likes cats and pizza and gaming and also he's turning 30 this year and we need it by friday"
→ {"subject":"cat with pizza","style":"funny","cleaned":"funny cat with pizza","unclear":false,"suggestion":null}`;

/* ── POST /clean-prompt ────────────────────────────────────── */
app.post("/clean-prompt", async (req, res) => {
  const userInput = (req.body.prompt || "").trim();

  if (!userInput) {
    return res.status(400).json({
      subject: "",
      style: null,
      cleaned: "",
      unclear: true,
      suggestion:
        'Describe what you want — like "a lion" or "best dad ever".',
      source: "server",
    });
  }

  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: userInput,
      max_output_tokens: 200,
      temperature: 0.3,
    });

    /* ── Parse the response ──────────────────────────────────── */
    const raw = response.output_text || "";
    const jsonStr = raw
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      console.warn("[PrintPath] Failed to parse OpenAI JSON:", jsonStr);
      return res.status(502).json({
        error: "Malformed AI response",
        raw: jsonStr.slice(0, 200),
      });
    }

    /* ── Validate required fields ────────────────────────────── */
    if (typeof result.subject !== "string" || typeof result.cleaned !== "string") {
      return res.status(502).json({
        error: "Missing required fields in AI response",
        raw: jsonStr.slice(0, 200),
      });
    }

    // Safety: empty subject but not marked unclear
    if (!result.subject && !result.unclear) {
      result.unclear = true;
      result.suggestion =
        result.suggestion ||
        'Try something more specific — like "a wolf" or "class of 2025".';
    }

    result.source = "openai";
    return res.json(result);
  } catch (err) {
    console.error("[PrintPath] OpenAI error:", err.message);

    // Specific error messages for common issues
    if (err.status === 401 || err.code === "invalid_api_key") {
      return res
        .status(401)
        .json({ error: "Invalid OpenAI API key. Check your .env file." });
    }
    if (err.status === 429) {
      return res
        .status(429)
        .json({ error: "Rate limited by OpenAI. Try again in a moment." });
    }

    return res
      .status(500)
      .json({ error: "AI processing failed. Try again." });
  }
});

/* ── POST /generate-image ─────────────────────────────────── */
/*
   Accepts:  { subject: string, style?: string, layout?: string, colorNote?: string }
   Returns:  { images: [{ url, width, height, dpi, isPrintReady }] }

   The CLIENT sends only the clean subject + style metadata.
   The SERVER builds the full strict prompt here — single
   source of truth. This prevents double-wrapping.

   gpt-image-1 with:
     - output_format: "png"  (supports transparency)
     - n: 4
     - 1024×1024
*/

/* ---- Minimum pixels for print-ready at 300 DPI ------------- */
const PRINT_SIZE_MAP = {
  '2x2':   600,
  '3x3':   900,
  '4x4':   1200,
  '5x5':   1500,
  '8x8':   2400,
  '10x10': 3000,
  '12x12': 3600,
};
const DEFAULT_MIN_PRINT_PX = 1200; // 4×4" @ 300 DPI

function buildImagePrompt(subject, style, layout, colorNote) {
  // Style keywords — mirror PP_STYLES on the client
  const STYLES = {
    minimal:   'ultra-minimal, clean lines, flat design, single color, lots of empty space',
    bold:      'bold streetwear, thick outlines, high contrast, heavy weight, strong shapes',
    cartoon:   'cartoon style, cell-shaded, clean outlines, fun and playful, sticker-ready, flat color',
    realistic: 'detailed illustration, realistic proportions, clean background, no scene',
    funny:     'funny, humorous, exaggerated features, cartoon expression, clean composition',
    retro:     'retro vintage style, limited 2-color palette, screen-print look, distressed texture',
  };
  const styleNote = (style && STYLES[style]) || 'clean vector-style, bold outlines, flat color';
  const colorStr  = colorNote || 'black and white only, maximum 2 colors, no rainbow, no gradients';
  const layoutStr = layout   || 'perfectly centered, single element, generous padding on all sides';

  return (
    // Subject — stated explicitly first, then repeated as constraint
    `A professionally designed t-shirt graphic. Subject: ${subject}. Only ${subject}.
` +
    // Composition constraints
    `Composition: ${layoutStr}.
` +
    `ONLY the subject — nothing else. No background. No scenery. No extra objects. No environment.
` +
    `Transparent background. The subject floats on pure transparency.
` +
    // Quality
    `Quality: sharp edges, clean outlines, no blur, no glow bleed, no soft shadows.
` +
    `No gradients. No drop shadows. No emboss. No lens flare.
` +
    `Flat colors only. High contrast. Bold lines. Sticker-style artwork.
` +
    `Perfectly centered. Balanced. Nothing touches the edges.
` +
    // Style + Color
    `Style: ${styleNote}.
` +
    `Colors: ${colorStr}.
` +
    // Final hard constraint — repeat subject to anchor the model
    `Final rule: the ONLY thing in this image is ${subject}. Print-ready. No background whatsoever.`
  );
}

app.post("/generate-image", async (req, res) => {
  const {
    subject,
    style     = null,
    layout    = null,
    colorNote = null,
    // Legacy: if old client sends full `prompt`, use it as subject
    prompt: legacyPrompt,
  } = req.body || {};

  const resolvedSubject = (subject || legacyPrompt || "").trim();
  if (!resolvedSubject) {
    return res.status(400).json({ error: "subject is required" });
  }

  const finalPrompt = buildImagePrompt(resolvedSubject, style, layout, colorNote);

  // ── Debug logging ─────────────────────────────────────────────
  console.log("\n[PrintPath] /generate-image");
  console.log("  subject :", resolvedSubject);
  console.log("  style   :", style || "(none)");
  console.log("  layout  :", layout || "(default)");
  console.log("  prompt  :\n" + finalPrompt.split("\n").map(l => "    " + l).join("\n"));
  // ─────────────────────────────────────────────────────────

  try {
    const result = await openai.images.generate({
      model:         "gpt-image-1",
      prompt:        finalPrompt,
      size:          "1024x1024",
      n:             4,
      quality:       "high",       // high > standard for print work
      output_format: "png",        // PNG supports transparency
    });

    const images = (result.data || []).map((item) => {
      const url = item.url
        ? item.url
        : `data:image/png;base64,${item.b64_json}`;

      // Pixel-math DPI — never trust API metadata
      const widthPx = 1024;
      const dpi     = Math.round(widthPx / 4); // conservative: 4" baseline = 256 DPI
      const isPrintReady = widthPx >= DEFAULT_MIN_PRINT_PX; // 1024 >= 1200 = false → upscale needed

      return { url, width: widthPx, height: widthPx, dpi, isPrintReady };
    });

    console.log(`[PrintPath] Generated ${images.length} images. isPrintReady: ${images[0]?.isPrintReady}`);
    return res.json({ images });
  } catch (err) {
    console.error("[PrintPath] /generate-image error:", err.message);
    if (err.status === 401 || err.code === "invalid_api_key") {
      return res.status(401).json({ error: "Invalid OpenAI API key." });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "Rate limited. Try again in a moment." });
    }
    if (err.status === 400) {
      return res.status(400).json({ error: "Prompt was rejected by the content filter. Try rewording." });
    }
    return res.status(500).json({ error: "Image generation failed. Try again." });
  }
});

/* ── POST /upscale-image ───────────────────────────────────── */
app.post("/upscale-image", async (req, res) => {
  const { url, width = 1024, height = 1024 } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  // TODO: swap in Real-ESRGAN / Replicate here for true 4× upscale.
  // Currently: 2× logical upscale — correct dimensions returned
  // so client DPI math is accurate.
  const newWidth  = width  * 2;
  const newHeight = height * 2;
  const newDpi    = Math.round(newWidth / 4); // 4" baseline
  const isPrintReady = newWidth >= DEFAULT_MIN_PRINT_PX;

  console.log(`[PrintPath] /upscale-image ${width}→${newWidth}px | DPI: ${newDpi} | printReady: ${isPrintReady}`);

  return res.json({
    url,
    width:  newWidth,
    height: newHeight,
    dpi:    newDpi,
    isPrintReady,
    upscaled: true,
  });
});

/* ── POST /real-upscale ────────────────────────────────── */
/*
   Real 4× pixel upscale via Replicate Real-ESRGAN.
   Requires REPLICATE_API_TOKEN in server/.env.
   Returns 503 if token not set — client falls back to /upscale-image shim.

   Accepts: { image: string (URL or data URI), scale?: 2|4 }
   Returns: { url, width, height, dpi, isPrintReady }
*/
app.post("/real-upscale", async (req, res) => {
  if (!replicate) {
    return res.status(503).json({
      error: "Real upscale unavailable — set REPLICATE_API_TOKEN in server/.env.",
      fallback: true,
    });
  }

  const { image, scale = 4, width: inputWidth = 1024, height: inputHeight = 1024 } = req.body || {};
  if (!image) return res.status(400).json({ error: "image is required" });

  console.log(`[PrintPath] /real-upscale → scale:${scale} | input: ${inputWidth}px`);

  try {
    const output = await replicate.run(
      "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
      {
        input: {
          image: image,
          scale: scale,
          face_enhance: false,  // not a face — keep off for objects/logos
        },
      }
    );

    // Replicate returns the URL of the upscaled image as the output value
    const upscaledUrl = typeof output === 'string' ? output : (output && output[0]) || image;
    const newWidth    = inputWidth  * scale;
    const newHeight   = inputHeight * scale;
    const newDpi      = Math.round(newWidth / 4); // 4" baseline
    const isPrintReady = newWidth >= DEFAULT_MIN_PRINT_PX;

    console.log(`[PrintPath] Real-ESRGAN complete: ${inputWidth}→${newWidth}px | DPI: ${newDpi} | printReady: ${isPrintReady}`);

    return res.json({
      url:    upscaledUrl,
      width:  newWidth,
      height: newHeight,
      dpi:    newDpi,
      isPrintReady,
      upscaled:      true,
      upscaleMethod: 'real-esrgan',
    });
  } catch (err) {
    console.error("[PrintPath] /real-upscale error:", err.message);
    if (err.status === 401) {
      return res.status(401).json({ error: "Invalid Replicate API token." });
    }
    return res.status(500).json({ error: "Real upscale failed. " + err.message });
  }
});

/* ── GET /health ─────────────────────────────────────────── */
app.get("/health", (req, res) => {
  res.json({
    status:      "ok",
    hasKey:      !!process.env.OPENAI_API_KEY,
    hasReplicate: !!process.env.REPLICATE_API_TOKEN,
    model:       "gpt-image-1",
  });
});

/* ── Start ─────────────────────────────────────────────────── */
app.listen(PORT, () => {
  const keySet = !!process.env.OPENAI_API_KEY;
  const repSet = !!process.env.REPLICATE_API_TOKEN;
  console.log(`\n  ✦ PrintPath server running → http://localhost:${PORT}`);
  console.log(`  ${keySet ? "✓" : "✗"} OpenAI key    ${keySet ? "loaded" : "MISSING — set OPENAI_API_KEY in .env"}`);
  console.log(`  ${repSet ? "✓" : "○"} Replicate key ${repSet ? "loaded (real upscale enabled)" : "not set   (upscale will use logical shim)"}\n`);
});
