// PrintPath — Production Server
// Run:  node server.js
// Env:  STRIPE_SECRET_KEY, SHOP_WEBHOOK_URL, BASE_URL, PORT

import express   from 'express';
import cors      from 'cors';
import Stripe    from 'stripe';
import { createServer } from 'http';
import { randomUUID }   from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import os from 'os';

// ── Config ────────────────────────────────────────────────────
const __dir   = dirname(fileURLToPath(import.meta.url));
const PORT    = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Stripe — will be null if key is missing (allows demo mode)
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe    = stripeKey ? new Stripe(stripeKey, { apiVersion: '2024-06-20' }) : null;

// Shop webhook endpoint (optional)
const SHOP_WEBHOOK = process.env.SHOP_WEBHOOK_URL || 'http://YOUR_SHOP_ENDPOINT/order';

// ── Orders file ───────────────────────────────────────────────
const ORDERS_FILE = join(__dir, 'orders.json');

function loadOrders() {
  try {
    if (!existsSync(ORDERS_FILE)) return { orders: [], log: [] };
    return JSON.parse(readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    return { orders: [], log: [] };
  }
}

function saveOrders(data) {
  writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// In-memory mirror (for fast reads, persisted to disk on every write)
let store = loadOrders();

// ── Helpers ───────────────────────────────────────────────────
function pad(n)    { return String(n).padStart(2, '0'); }
function nowStr()  {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addLog(msg) {
  const entry = { msg, ts: nowStr(), at: new Date().toISOString() };
  store.log.unshift(entry);
  if (store.log.length > 100) store.log.pop();
  console.log(`[${entry.ts}] ${msg}`);
}

// ── Pricing Engine ───────────────────────────────────────────
//
//  calculatePrice(size, qty) → final customer price (USD, rounded to cents)
//
//  Size base rates (per unit):
//    3"  → $0.18 / sticker
//    5"  → $0.32 / sticker
//    7"  → $0.52 / sticker
//
//  Bulk discount tiers (applied to subtotal before markup):
//    qty >=  500 → 25% off
//    qty >=  200 → 18% off
//    qty >=  100 → 12% off
//    qty >=   50 →  7% off
//    qty <    50 →  0% off
//
//  Then: +40% markup + $5 flat AI fee

const SIZE_BASE = {
  '3"': 0.18,
  '5"': 0.32,
  '7"': 0.52,
};

function bulkDiscount(qty) {
  if (qty >= 500) return 0.25;
  if (qty >= 200) return 0.18;
  if (qty >= 100) return 0.12;
  if (qty >=  50) return 0.07;
  return 0;
}

function calculatePrice(size, qty) {
  const base     = SIZE_BASE[size] ?? SIZE_BASE['3"'];
  const subtotal = base * qty;
  const discount = subtotal * bulkDiscount(qty);
  const afterDiscount = subtotal - discount;
  const withMarkup    = afterDiscount * 1.4;   // +40% markup
  const total         = withMarkup + 5;         // +$5 AI fee
  return Math.round(total * 100) / 100;         // round to cents
}

// Shop payout ≈ 60% of customer price
function calcPayout(size, qty) {
  return Math.round(calculatePrice(size, qty) * 0.6 * 100) / 100;
}

// Notify shop after a paid order is created
async function notifyShop(order) {
  if (!SHOP_WEBHOOK || SHOP_WEBHOOK.includes('YOUR_SHOP_ENDPOINT')) return;
  try {
    const res = await fetch(SHOP_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId:   order.id,
        text:      order.text,
        qty:       order.qty,
        size:      order.size,
        finish:    order.finish,
        payout:    order.payout,
        createdAt: order.createdAt,
      }),
    });
    addLog(`Shop notified: ${res.status} for ${order.id}`);
  } catch (err) {
    addLog(`Shop notify failed: ${err.message}`);
  }
}

// ── Express App ───────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (success.html etc.) from same folder
app.use(express.static(__dir));

// ── ROUTES ────────────────────────────────────────────────────

// Health check
app.get('/ping', (_req, res) => {
  res.json({
    ok:      true,
    time:    new Date().toISOString(),
    orders:  store.orders.length,
    stripe:  !!stripe,
    baseUrl: BASE_URL,
  });
});

// GET /price?size=3"&qty=50 — return calculated price
app.get('/price', (req, res) => {
  const size   = req.query.size || '3"';
  const qty    = Math.max(1, Number(req.query.qty) || 50);
  const price  = calculatePrice(size, qty);
  const payout = calcPayout(size, qty);
  const disc   = Math.round(bulkDiscount(qty) * 100);
  res.json({ size, qty, price, payout, discountPct: disc });
});

// GET /orders — return all orders + log
app.get('/orders', (_req, res) => {
  res.json({ orders: store.orders, log: store.log });
});

// POST /order — create a manual / demo order (no payment)
app.post('/order', (req, res) => {
  const { text, size, qty } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }

  const order = {
    id:        'ORD-' + randomUUID().slice(0, 6).toUpperCase(),
    text:      text.trim().slice(0, 120),
    status:    'new',
    paid:      false,
    payout:    calcPayout(size || '3"', Number(qty) || 50),
    price:     calculatePrice(size || '3"', Number(qty) || 50),
    size:      size  || '3"',
    qty:       Number(qty) || 50,
    finish:    ['Matte', 'Gloss', 'Holographic'][Math.floor(Math.random() * 3)],
    createdAt: new Date().toISOString(),
  };

  store.orders.unshift(order);
  saveOrders(store);
  addLog(`New order ${order.id}: "${order.text.slice(0, 40)}"`);
  res.status(201).json(order);
});

// POST /update — update order status
app.post('/update', (req, res) => {
  const { id, update } = req.body;
  if (!id || !update) return res.status(400).json({ error: 'id and update required' });

  const order = store.orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'not found' });

  Object.assign(order, update, { updatedAt: new Date().toISOString() });
  saveOrders(store);

  if (update.status === 'printing')  addLog(`Accepted ${id} — earning $${order.payout}`);
  else if (update.status === 'done') addLog(`Completed ${id}`);
  else if (update.status === 'forwarded') addLog(`Forwarded ${id} to partner`);

  res.json(order);
});

// ── STRIPE ───────────────────────────────────────────────────

// POST /create-checkout-session
// Body: { text, size, qty }
app.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in .env' });
  }

  const { text, size, qty } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const qtyNum  = Math.max(1, Math.min(10000, Number(qty) || 50));
  const sizeStr = ['3"','5"','7"'].includes(size) ? size : '3"';
  const price   = calculatePrice(sizeStr, qtyNum);
  const unitCents = Math.round(price * 100);
  const discPct   = Math.round(bulkDiscount(qtyNum) * 100);

  const descParts = [
    text.slice(0, 300),
    `Size: ${sizeStr} | Qty: ${qtyNum}`,
    discPct > 0 ? `Bulk discount: ${discPct}% applied` : null,
    `Includes AI design fee`,
  ].filter(Boolean).join(' · ');

  // Encode order info in metadata so we can create the real order on success
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency:     'usd',
          product_data: {
            name:        `Custom Sticker — ${sizeStr} × Qty ${qtyNum}`,
            description: descParts,
            images:      [],
          },
          unit_amount: unitCents,
        },
        quantity: 1,
      }],
      metadata: {
        design_text: text.slice(0, 500),
        size:        sizeStr,
        qty:         String(qtyNum),
      },
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${BASE_URL}/`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /success — called after Stripe payment
// Stripe redirects here with ?session_id=xxx
// We verify payment, create the real order, save it, notify shop
app.get('/success', async (req, res) => {
  const { session_id } = req.query;

  if (!stripe || !session_id) {
    // No Stripe configured — show generic success
    return res.sendFile(join(__dir, 'success.html'));
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(402).send('Payment not completed.');
    }

    // Check if we already processed this session (idempotency)
    const existing = store.orders.find(o => o.stripeSessionId === session.id);
    if (!existing) {
      const meta   = session.metadata || {};
      const qtyNum = Number(meta.qty) || 50;

      const orderSize = ['3"','5"','7"'].includes(meta.size) ? meta.size : '3"';
      const order = {
        id:              'ORD-' + randomUUID().slice(0, 6).toUpperCase(),
        text:            (meta.design_text || '').slice(0, 120),
        status:          'paid',
        paid:            true,
        price:           calculatePrice(orderSize, qtyNum),
        payout:          calcPayout(orderSize, qtyNum),
        size:            orderSize,
        qty:             qtyNum,
        finish:          'Matte',
        stripeSessionId: session.id,
        amountPaid:      session.amount_total / 100,
        customerEmail:   session.customer_details?.email || null,
        createdAt:       new Date().toISOString(),
      };

      store.orders.unshift(order);
      saveOrders(store);
      addLog(`💳 Paid order ${order.id}: "${order.text.slice(0, 40)}" — $${order.amountPaid}`);

      // Notify shop asynchronously
      notifyShop(order);
    }

    // Serve the success page
    res.sendFile(join(__dir, 'success.html'));
  } catch (err) {
    console.error('Success handler error:', err.message);
    res.status(500).send('Something went wrong: ' + err.message);
  }
});

// Reset (demo only)
app.post('/reset', (_req, res) => {
  store = { orders: [], log: [] };
  saveOrders(store);
  addLog('Demo reset');
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────
const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips  = Object.values(nets)
    .flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal)
    .map(n => n.address);

  console.log('\n─────────────────────────────────────────');
  console.log('  PrintPath Production Server — running ✓');
  console.log('─────────────────────────────────────────');
  console.log(`  Local:    http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network:  http://${ip}:${PORT}`));
  console.log(`  Stripe:   ${stripe ? '✓ configured' : '✗ missing STRIPE_SECRET_KEY'}`);
  console.log(`  Orders:   ${ORDERS_FILE}`);
  console.log('─────────────────────────────────────────\n');
  addLog('Server started');
});
