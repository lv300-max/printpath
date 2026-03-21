/* ============================================================
   Netlify Function — create-subscription
   GET /create-subscription
   Returns: { url } — Stripe Checkout URL for $29/mo Pro subscription
============================================================ */

import Stripe from 'stripe';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: 'Stripe not configured' }, 503);

  const stripe = new Stripe(key, { apiVersion: '2023-10-16' });

  // Get or create the Pro monthly price
  // First, look for existing product/price by metadata
  let priceId = process.env.STRIPE_PRO_PRICE_ID;

  if (!priceId) {
    // Create product + price on the fly if not pre-configured
    const product = await stripe.products.create({
      name: 'PrintPath Pro',
      description: 'Unlimited print-ready designs for your shop. 300 DPI locked, cart attach, die-cut support.',
      metadata: { app: 'printpath', plan: 'pro' },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2900,       // $29.00
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    priceId = price.id;
  }

  const origin = req.headers.get('origin') || 'https://printpath-ai.netlify.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/shop-dashboard.html?pro=success`,
    cancel_url:  `${origin}/?pro=cancelled`,
    allow_promotion_codes: true,
    metadata: { plan: 'pro' },
  });

  return json({ url: session.url });
};

export const config = { path: '/create-subscription' };
