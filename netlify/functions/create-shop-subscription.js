/* ============================================================
   Netlify Function — create-shop-subscription
   POST /create-shop-subscription
   Body: { shopId, tier }  (tier: 2–5)
   Returns: { url } — Stripe Checkout URL

   Level  Price    Features unlocked
   2      $29/mo   Resize + scale tools
   3      $59/mo   Color adjust + CMYK
   4      $99/mo   Die-cut + sticker mode
   5      $149/mo  Full pro — all tools
============================================================ */

import Stripe from 'stripe';

const TIERS = {
  2: { amount: 2900,  label: 'PrintPath Level 2 — Resize & Scale' },
  3: { amount: 5900,  label: 'PrintPath Level 3 — Color Tools' },
  4: { amount: 9900,  label: 'PrintPath Level 4 — Die-Cut & Print' },
  5: { amount: 14900, label: 'PrintPath Level 5 — Full Pro' },
};

const ENV_PRICE_IDS = {
  2: process.env.STRIPE_SHOP_L2_PRICE_ID,
  3: process.env.STRIPE_SHOP_L3_PRICE_ID,
  4: process.env.STRIPE_SHOP_L4_PRICE_ID,
  5: process.env.STRIPE_SHOP_L5_PRICE_ID,
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: 'Stripe not configured' }, 503);

  let shopId = 'unknown';
  let tier   = 2;
  try {
    const body = await req.json();
    shopId = body.shopId || 'unknown';
    tier   = parseInt(body.tier) || 2;
  } catch (_) {}

  if (!TIERS[tier]) return json({ error: 'Invalid tier: ' + tier }, 400);

  const stripe = new Stripe(key, { apiVersion: '2023-10-16' });

  let priceId = ENV_PRICE_IDS[tier];

  if (!priceId) {
    const t = TIERS[tier];
    const product = await stripe.products.create({
      name: t.label,
      description: 'PrintPath print shop tool — ' + t.label,
      metadata: { app: 'printpath', plan_level: String(tier) },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: t.amount,
      currency: 'usd',
      recurring: { interval: 'month' },
    });
    priceId = price.id;
  }

  const origin = req.headers.get('origin') || 'https://printpath-ai.netlify.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { shopId, tier: String(tier) },
    success_url: `${origin}/shop-dashboard.html?shop_pro=success&shopId=${shopId}&tier=${tier}`,
    cancel_url:  `${origin}/shop-dashboard.html?shopId=${shopId}`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    subscription_data: { metadata: { shopId, tier: String(tier) } },
  });

  return json({ url: session.url });
};
