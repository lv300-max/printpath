// PrintPath Web Demo — Express server
// Run: node demo-server.js
// Serves: GET /orders, POST /order, POST /update, GET /ping

import express from 'express';
import cors    from 'cors';
import { createServer } from 'http';
import { randomUUID }   from 'crypto';
import os               from 'os';

const app  = express();
const PORT = 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── In-memory store ───────────────────────────────────────────
let orders  = [];
let activityLog = [];

function log(msg) {
  const entry = { msg, ts: new Date().toLocaleTimeString() };
  activityLog.unshift(entry);
  if (activityLog.length > 50) activityLog.pop();
  console.log(`[${entry.ts}] ${msg}`);
}

// ── Helpers ───────────────────────────────────────────────────
function randomPayout() {
  return parseFloat((10 + Math.random() * 20).toFixed(2));
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Routes ────────────────────────────────────────────────────

// Health check / local IP helper
app.get('/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), orders: orders.length });
});

// Return all orders + activity log
app.get('/orders', (_req, res) => {
  res.json({ orders, log: activityLog });
});

// Create a new order
app.post('/order', (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }

  const order = {
    id:        'ORD-' + randomUUID().slice(0, 6).toUpperCase(),
    text:      text.trim().slice(0, 120),
    status:    'new',
    payout:    randomPayout(),
    size:      '3"',
    qty:       50,
    finish:    ['Matte', 'Gloss', 'Holographic'][Math.floor(Math.random() * 3)],
    createdAt: new Date().toISOString(),
  };

  orders.unshift(order);
  log(`New order ${order.id}: "${order.text.slice(0, 40)}"`);
  res.status(201).json(order);
});

// Update an order
app.post('/update', (req, res) => {
  const { id, update } = req.body;
  if (!id || !update) return res.status(400).json({ error: 'id and update required' });

  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'not found' });

  Object.assign(order, update, { updatedAt: new Date().toISOString() });

  if (update.status === 'printing') {
    log(`Accepted ${id} — earning $${order.payout}`);
  } else if (update.status === 'done') {
    log(`Completed ${id}`);
  } else if (update.status === 'forwarded') {
    log(`Forwarded ${id} to partner`);
  }

  res.json(order);
});

// Clear all orders (demo reset)
app.post('/reset', (_req, res) => {
  orders = [];
  activityLog = [];
  log('Demo reset');
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────
const server = createServer(app);
server.listen(PORT, '0.0.0.0', () => {
  // Print all local IPs
  const nets = os.networkInterfaces();
  const ips  = Object.values(nets)
    .flat()
    .filter(n => n.family === 'IPv4' && !n.internal)
    .map(n => n.address);

  console.log('\n─────────────────────────────────────');
  console.log('  PrintPath Demo Server — running ✓');
  console.log('─────────────────────────────────────');
  console.log(`  Local:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  Network: http://${ip}:${PORT}`));
  console.log('─────────────────────────────────────\n');
  log('Server started');
});
