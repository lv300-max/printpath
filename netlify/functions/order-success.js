/* ============================================================
   Netlify Function — order-success
   GET /success?session_id=xxx
   Verifies Stripe payment, notifies shop, serves success page
============================================================ */

import Stripe from 'stripe';

export default async (req) => {
  const key = process.env.STRIPE_SECRET_KEY;

  // No Stripe key or no session_id — just serve the static success page
  const url       = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');

  if (!key || !sessionId) {
    return Response.redirect(url.origin + '/success.html', 302);
  }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return new Response('Payment not completed.', { status: 402 });
    }

    const meta   = session.metadata || {};
    const qty    = Number(meta.qty)   || 50;
    const size   = meta.size          || '3"';
    const text   = meta.design_text   || '';
    const price  = meta.price         || session.amount_total / 100;
    const email  = session.customer_details?.email || '';

    // Notify shop webhook (optional — fire and forget)
    const shopWebhook = process.env.SHOP_WEBHOOK_URL;
    if (shopWebhook && !shopWebhook.includes('YOUR_SHOP')) {
      fetch(shopWebhook, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId: session.id,
          text, qty, size, price,
          customerEmail: email,
          paidAt: new Date().toISOString(),
        }),
      }).catch(() => {});   // non-blocking
    }

    // Build the success page HTML inline so no redirect is needed
    const html = successPage({ text, qty, size, price, email, sessionId });
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (err) {
    console.error('Success handler error:', err.message);
    return new Response('Something went wrong: ' + err.message, { status: 500 });
  }
};

// ── Success page HTML ──────────────────────────────────────────────
function successPage({ text, qty, size, price, email, sessionId }) {
  const shortId = sessionId?.slice(-8).toUpperCase() ?? '—';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Order Confirmed — PrintPath</title>
<link rel="icon" href="/favicon.png"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#060609;--bg2:#0d0d1a;--bg3:#131325;--border:rgba(255,255,255,0.07);
--text:#f0f0f8;--text2:#8888a8;--green:#00ff9c;--green2:#00cc7a;
--gdim:rgba(0,255,156,0.1);--gglow:0 0 40px rgba(0,255,156,0.2);
--radius:16px;--ease:cubic-bezier(0.22,1,0.36,1)}
html,body{min-height:100%;background:var(--bg);color:var(--text);
font-family:-apple-system,'Inter',BlinkMacSystemFont,'Segoe UI',sans-serif;
font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;
display:grid;place-items:center;padding:24px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);
padding:40px 36px;max-width:440px;width:100%;text-align:center;
animation:up .5s var(--ease)}
@keyframes up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.check-wrap{width:72px;height:72px;border-radius:50%;background:var(--gdim);
border:2px solid rgba(0,255,156,0.3);display:grid;place-items:center;
margin:0 auto 24px;box-shadow:var(--gglow)}
.check-wrap svg{width:32px;height:32px;color:var(--green)}
h1{font-size:1.45rem;font-weight:800;letter-spacing:-.03em;margin-bottom:6px}
.sub{font-size:.9rem;color:var(--text2);margin-bottom:28px}
.order-box{background:var(--bg3);border:1px solid var(--border);border-radius:12px;
padding:16px 18px;text-align:left;margin-bottom:24px;display:flex;flex-direction:column;gap:10px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.row-label{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text2)}
.row-val{font-size:.88rem;font-weight:600;color:var(--text);text-align:right;word-break:break-word;max-width:60%}
.row-val.green{color:var(--green);font-size:1rem;font-weight:800}
.steps{display:flex;flex-direction:column;gap:8px;margin-bottom:28px;text-align:left}
.step{display:flex;align-items:flex-start;gap:10px;font-size:.82rem;color:var(--text2)}
.step-num{width:22px;height:22px;border-radius:50%;background:var(--gdim);
border:1px solid rgba(0,255,156,0.25);display:grid;place-items:center;
font-size:.65rem;font-weight:800;color:var(--green);flex-shrink:0;margin-top:1px}
.btn-home{display:inline-flex;align-items:center;justify-content:center;gap:8px;
height:44px;padding:0 24px;border-radius:10px;
background:var(--green);color:#030d09;font-size:.85rem;font-weight:700;
border:none;cursor:pointer;text-decoration:none;
transition:all .2s var(--ease)}
.btn-home:hover{background:var(--green2);box-shadow:var(--gglow);transform:translateY(-1px)}
.ref{font-size:.65rem;color:var(--text2);margin-top:16px;opacity:.6}
</style>
</head>
<body>
<div class="card">
  <div class="check-wrap">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  </div>
  <h1>Order confirmed!</h1>
  <p class="sub">Your design is heading to the print shop.</p>

  <div class="order-box">
    <div class="row">
      <span class="row-label">Design</span>
      <span class="row-val">${escHtml(text) || '—'}</span>
    </div>
    <div class="row">
      <span class="row-label">Size</span>
      <span class="row-val">${escHtml(size)} sticker</span>
    </div>
    <div class="row">
      <span class="row-label">Quantity</span>
      <span class="row-val">${qty} stickers</span>
    </div>
    ${email ? `<div class="row"><span class="row-label">Email</span><span class="row-val">${escHtml(email)}</span></div>` : ''}
    <div class="row">
      <span class="row-label">Total paid</span>
      <span class="row-val green">$${Number(price).toFixed(2)}</span>
    </div>
  </div>

  <div class="steps">
    <div class="step"><div class="step-num">1</div><span>Your design is queued at the print shop</span></div>
    <div class="step"><div class="step-num">2</div><span>Print-ready file prepared at 300 DPI</span></div>
    <div class="step"><div class="step-num">3</div><span>Die-cut stickers shipped to you</span></div>
  </div>

  <a href="/" class="btn-home">← Back to PrintPath</a>
  <div class="ref">Order ref: ${shortId}</div>
</div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const config = { path: '/success' };
