/* ============================================================
   Netlify Function — upscale-image
   POST /.netlify/functions/upscale-image
   Body: { url: string, width?: number, height?: number }
   ============================================================ */

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

  const { url, width = 1024, height = 1024 } = body;
  if (!url) {
    return new Response(JSON.stringify({ error: "url is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // TODO: swap in Real-ESRGAN / Replicate here for 4× upscale
  return new Response(
    JSON.stringify({
      url,
      width:    width  * 2,
      height:   height * 2,
      dpi:      192,
      upscaled: true,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/upscale-image" };
