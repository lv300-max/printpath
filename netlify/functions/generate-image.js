/* ============================================================
   Netlify Function — generate-image
   POST /.netlify/functions/generate-image
   Body: { prompt: string }
   ============================================================ */

import OpenAI from "openai";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawPrompt = (body.prompt || "").trim();
  if (!rawPrompt) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const finalPrompt =
    `A clean, centered design of: ${rawPrompt}.\n` +
    `Single subject only.\n` +
    `No background. No scenery. No extra objects.\n` +
    `Transparent background.\n` +
    `High contrast. Sharp edges. Minimal.\n` +
    `Vector style, bold lines, flat colors, clean edges.\n` +
    `Sticker style. Print-ready.`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const result = await openai.images.generate({
      model:      "gpt-image-1",
      prompt:     finalPrompt,
      size:       "1024x1024",
      n:          4,
      background: "transparent",
      quality:    "standard",
    });

    const images = (result.data || []).map((item) => ({
      url: item.url ? item.url : `data:image/png;base64,${item.b64_json}`,
      width:  1024,
      height: 1024,
      dpi:    96,
    }));

    return new Response(JSON.stringify({ images }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[PrintPath] generate-image error:", err.message);
    const status =
      err.status === 401 ? 401 :
      err.status === 429 ? 429 :
      err.status === 400 ? 400 : 500;
    const message =
      err.status === 401 ? "Invalid OpenAI API key." :
      err.status === 429 ? "Rate limited. Try again in a moment." :
      err.status === 400 ? "Prompt was rejected by the content filter. Try rewording." :
      "Image generation failed. Try again.";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/generate-image" };
