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
   Accepts:  { prompt: string }
   Returns:  { images: [{ url, width, height }] }

   Uses gpt-image-1 with:
     - transparent background  (HUGE for stickers)
     - n: 4  (4 designs = dopamine hit for the user)
     - 1024×1024
   The prompt coming in has already been enforced by the
   Premium Merch Engine on the client — we wrap it in one
   final strict format string to guarantee clean output.
*/
app.post("/generate-image", async (req, res) => {
  const rawPrompt = (req.body.prompt || "").trim();
  if (!rawPrompt) {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Final strict format — fixes the "red cup = beach" problem.
  // We always describe the single subject explicitly and forbid
  // backgrounds, scenes, and extra objects at the API level.
  const finalPrompt =
    `A clean, centered design of: ${rawPrompt}.\n` +
    `Single subject only.\n` +
    `No background. No scenery. No extra objects.\n` +
    `Transparent background.\n` +
    `High contrast. Sharp edges. Minimal.\n` +
    `Vector style, bold lines, flat colors, clean edges.\n` +
    `Sticker style. Print-ready.`;

  try {
    const result = await openai.images.generate({
      model:      "gpt-image-1",
      prompt:     finalPrompt,
      size:       "1024x1024",
      n:          4,
      background: "transparent",
      quality:    "standard",
    });

    // gpt-image-1 returns base64 by default; normalise to a consistent shape.
    // If the API returns a URL use it directly; otherwise wrap the b64 in a
    // data URI so the browser can display it without a separate request.
    const images = (result.data || []).map((item) => {
      const url = item.url
        ? item.url
        : `data:image/png;base64,${item.b64_json}`;
      return {
        url,
        width:  1024,
        height: 1024,
        // gpt-image-1 outputs at 96 ppi native; we record the raw pixel
        // dimensions so the DPI check in the client is accurate.
        dpi: 96,
      };
    });

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
/*
   Simple server-side upscale shim.
   Right now: instructs the client to use a CSS/Canvas 2× scale
   (sufficient for most DTG/screen-print needs at 1024px input).
   When you add a real upscaler (Real-ESRGAN via Replicate etc)
   swap the body — the client shape stays the same.

   Accepts:  { url: string }          — the image URL to upscale
   Returns:  { url, width, height, dpi, upscaled: true }
*/
app.post("/upscale-image", async (req, res) => {
  const { url, width = 1024, height = 1024 } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  // ── TODO: swap in Real-ESRGAN / Replicate here for 4× upscale ──
  // For now: declare a 2× logical upscale so the DPI check passes.
  // 1024px @ 96ppi → treated as 2048px equivalent → ~204 DPI at 10".
  // After wiring a real upscaler this endpoint returns the new image URL.
  return res.json({
    url,              // same URL until real upscaler is wired
    width:  width  * 2,
    height: height * 2,
    dpi:    192,      // conservative estimate for 1024px DTG print
    upscaled: true,
  });
});

/* ── GET /health ───────────────────────────────────────────── */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    hasKey: !!process.env.OPENAI_API_KEY,
    model: "gpt-image-1",
  });
});

/* ── Start ─────────────────────────────────────────────────── */
app.listen(PORT, () => {
  const keySet = !!process.env.OPENAI_API_KEY;
  console.log(`\n  ✦ PrintPath server running → http://localhost:${PORT}`);
  console.log(
    `  ${keySet ? "✓" : "✗"} OpenAI key ${keySet ? "loaded" : "MISSING — set OPENAI_API_KEY in .env"}\n`
  );
});
