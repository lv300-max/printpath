/* ============================================================
   Netlify Function — health
   GET /.netlify/functions/health
   ============================================================ */

export default async (req) => {
  return new Response(
    JSON.stringify({
      status: "ok",
      hasKey: !!process.env.OPENAI_API_KEY,
      model:  "gpt-image-1",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/health" };
