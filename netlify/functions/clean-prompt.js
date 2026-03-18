/* ============================================================
   Netlify Function — clean-prompt
   POST /.netlify/functions/clean-prompt
   Body: { prompt: string }
   ============================================================ */

import OpenAI from "openai";

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

  const userInput = (body.prompt || "").trim();

  if (!userInput) {
    return new Response(
      JSON.stringify({
        subject: "",
        style: null,
        cleaned: "",
        unclear: true,
        suggestion: 'Describe what you want — like "a lion" or "best dad ever".',
        source: "server",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: SYSTEM_PROMPT,
      input: userInput,
      max_output_tokens: 200,
      temperature: 0.3,
    });

    const raw = response.output_text || "";
    const jsonStr = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch {
      return new Response(
        JSON.stringify({ error: "Malformed AI response", raw: jsonStr.slice(0, 200) }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    if (typeof result.subject !== "string" || typeof result.cleaned !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing required fields in AI response" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!result.subject && !result.unclear) {
      result.unclear = true;
      result.suggestion = result.suggestion || 'Try something more specific — like "a wolf" or "class of 2025".';
    }

    result.source = "openai";
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[PrintPath] clean-prompt error:", err.message);
    const status = err.status === 401 ? 401 : err.status === 429 ? 429 : 500;
    const message =
      err.status === 401 ? "Invalid OpenAI API key." :
      err.status === 429 ? "Rate limited. Try again in a moment." :
      "AI processing failed. Try again.";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/clean-prompt" };
