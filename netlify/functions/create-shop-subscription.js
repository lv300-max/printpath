/* ============================================================
   Netlify Function — create-shop-subscription
   POST /create-shop-subscription
   Body: { shopId }
   Returns: { url } — Stripe Checkout URL for $29/mo Shop Pro plan
============================================================ */

import Stripe from 'stripe';

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
  try {
    const body = await req.json();
    shopId = body.shopId || 'unknown';
  } catch (_) {}

  const stripe = new Stripe(key, { apiVersion: '2023-10-16' });

  // Use pre-configured shop pro price, or create on the fly
  let priceId = process.env.STRIPE_SHOP_PRO_PRICE_ID;

  if (!priceId) {
    const product = await stripe.products.create({
      name: 'PrintPath Shop Pro',
      description: 'Full design tools for your print shop customers. Watermark removed, all tools unlocked.',
      metadata: { app: 'printpath', plan: 'shop_pro' },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2900,
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    priceId = price.id;
  }

  const origin = req.headers.get('origin') || 'https://printpath-ai.netlify.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { shopId },
    success_url: `${origin}/shop-dashboard.html?shop_pro=success&shopId=${shopId}`,
    cancel_url:  `${origin}/shop-dashboard.html`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    subscription_data: {
      metadata: { shopId },
    },
  });

  return json({ url: session.url });
};
