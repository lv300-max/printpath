/* ============================================================
   Netlify Function — create-checkout-session
   POST /create-checkout-session
   Body: { text, size, qty }
   Returns: { url } — Stripe Checkout URL
============================================================ */

import Stripe from 'stripe';

// ── Pricing engine (mirrors server.js + Print Path Web Demo.html) ──
const SIZE_BASE = { '3"': 0.18, '5"': 0.32, '7"': 0.52 };

function bulkDiscount(qty) {
  if (qty >= 500) return 0.25;
  if (qty >= 200) return 0.18;
  if (qty >= 100) return 0.12;
  if (qty >=  50) return 0.07;
  return 0;
}

function calculatePrice(size, qty) {
  const base          = SIZE_BASE[size] ?? SIZE_BASE['3"'];
  const subtotal      = base * qty;
  const afterDiscount = subtotal * (1 - bulkDiscount(qty));
  const withMarkup    = afterDiscount * 1.4;
  const total         = withMarkup + 5;           // +$5 AI fee
  return Math.round(total * 100) / 100;
}

// ── Handler ────────────────────────────────────────────────────────
export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return json({ error: 'Stripe not configured on server' }, 503);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { text, size, qty } = body;
  if (!text || typeof text !== 'string') {
    return json({ error: 'text is required' }, 400);
  }

  const qtyNum  = Math.max(1, Math.min(10000, Number(qty) || 50));
  const sizeStr = ['3"', '5"', '7"'].includes(size) ? size : '3"';
  const price   = calculatePrice(sizeStr, qtyNum);
  const discPct = Math.round(bulkDiscount(qtyNum) * 100);

  const origin = req.headers.get('origin') || 'https://printpath-ai.netlify.app';

  const descParts = [
    text.slice(0, 300),
    `Size: ${sizeStr} | Qty: ${qtyNum}`,
    discPct > 0 ? `Bulk discount: ${discPct}% applied` : null,
    'Includes AI design fee',
  ].filter(Boolean).join(' · ');

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency:     'usd',
          product_data: {
            name:        `Custom Sticker — ${sizeStr} × Qty ${qtyNum}`,
            description: descParts,
            images:      ['https://printpath-ai.netlify.app/logo.png'],
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      metadata: {
        design_text: text.slice(0, 500),
        size:        sizeStr,
        qty:         String(qtyNum),
        price:       String(price),
      },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/`,
    });

    return json({ url: session.url, sessionId: session.id, price });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return json({ error: err.message }, 500);
  }
};

// ── Helpers ────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export const config = { path: '/create-checkout-session' };
