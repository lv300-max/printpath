/* ============================================================
   PrintPath Network — Data Model & Routing Logic
   localStorage-backed. No backend required for V1.

   Keys:
     pp-network-shops   → ShopNetwork[]
     pp-network-orders  → NetworkOrder[]
   ============================================================ */

'use strict';

/* ====================================================
   STORAGE KEYS
   ==================================================== */
const PN_SHOPS_KEY  = 'pp-network-shops';
const PN_ORDERS_KEY = 'pp-network-orders';

/* ====================================================
   SHOP STATUS ENUM
   ==================================================== */
const SHOP_STATUS = {
  AVAILABLE: 'available',
  BUSY:      'busy',
  OFFLINE:   'offline',
  PAUSED:    'paused',
};

/* ====================================================
   ORDER STATUS ENUM
   Internal statuses — customers only see simplified view.
   ==================================================== */
const ORDER_STATUS = {
  NEW:           'new',
  ASSIGNED:      'assigned',
  ACCEPTED:      'accepted',
  FORWARDED:     'forwarded',
  IN_PRODUCTION: 'in_production',
  COMPLETED:     'completed',
  CANCELLED:     'cancelled',
};

/* ====================================================
   CUSTOMER-FACING STATUS MAP
   Never expose internal forwarding to customers.
   ==================================================== */
const CUSTOMER_STATUS_MAP = {
  new:           'Order Received',
  assigned:      'Order Received',
  accepted:      'In Production',
  forwarded:     'In Production',   // customer never sees "forwarded"
  in_production: 'In Production',
  completed:     'Completed',
  cancelled:     'Cancelled',
};

/* ====================================================
   SHOP MODEL
   {
     shopId:                string   (uuid)
     name:                  string
     email:                 string
     phone:                 string
     address:               string
     supportedProducts:     string[] e.g. ['shirt','sticker','hoodie']
     capacityPerDay:        number
     currentLoad:           number   (orders today)
     status:                SHOP_STATUS
     averageTurnaroundDays: number
     qualityScore:          number   (0–100)
     joinedAt:              ISO string
   }
   ==================================================== */

/* ====================================================
   ORDER MODEL (Network layer — extends handoff orders)
   {
     orderId:            string   (uuid)
     designId:           string   (from td-outgoing-orders)
     imageUrl:           string
     prompt:             string
     size:               string
     qty:                number
     productType:        string   e.g. 'shirt'
     status:             ORDER_STATUS
     assignedShopId:     string|null
     finalPrinterShopId: string|null
     forwardedByShopId:  string|null
     totalPaid:          number
     platformFee:        number
     productionPayout:   number
     createdAt:          ISO string
     updatedAt:          ISO string
     timeline:           TimelineEvent[]
   }

   TimelineEvent:
   {
     event:     string   e.g. 'assigned' | 'accepted' | 'forwarded' | 'production_started' | 'completed'
     shopId:    string|null
     note:      string
     timestamp: ISO string
   }
   ==================================================== */

/* ====================================================
   LOAD / SAVE
   ==================================================== */
function pnLoadShops() {
  try {
    const raw = localStorage.getItem(PN_SHOPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function pnSaveShops(shops) {
  try {
    localStorage.setItem(PN_SHOPS_KEY, JSON.stringify(shops));
  } catch (e) { console.warn('[PrintPath Network] Could not save shops:', e); }
}

function pnLoadOrders() {
  try {
    const raw = localStorage.getItem(PN_ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function pnSaveOrders(orders) {
  try {
    localStorage.setItem(PN_ORDERS_KEY, JSON.stringify(orders));
  } catch (e) { console.warn('[PrintPath Network] Could not save orders:', e); }
}

/* ====================================================
   SHOP HELPERS
   ==================================================== */

/** Generate a simple unique ID */
function pnUid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Create a new shop object with defaults */
function pnCreateShop(overrides = {}) {
  return Object.assign({
    shopId:                pnUid(),
    name:                  '',
    email:                 '',
    phone:                 '',
    address:               '',
    supportedProducts:     ['shirt', 'sticker'],
    capacityPerDay:        20,
    currentLoad:           0,
    status:                SHOP_STATUS.AVAILABLE,
    averageTurnaroundDays: 3,
    qualityScore:          80,
    joinedAt:              new Date().toISOString(),
  }, overrides);
}

/** Add or update a shop */
function pnSaveShop(shopData) {
  const shops = pnLoadShops();
  const idx   = shops.findIndex(s => s.shopId === shopData.shopId);
  if (idx >= 0) {
    shops[idx] = Object.assign({}, shops[idx], shopData);
  } else {
    shops.push(shopData);
  }
  pnSaveShops(shops);
  return shopData;
}

/** Delete a shop */
function pnDeleteShop(shopId) {
  const shops = pnLoadShops().filter(s => s.shopId !== shopId);
  pnSaveShops(shops);
}

/**
 * Auto-update shop status based on load vs capacity.
 * If currentLoad >= capacityPerDay → busy (unless offline/paused).
 */
function pnRefreshShopStatus(shop) {
  if (shop.status === SHOP_STATUS.OFFLINE || shop.status === SHOP_STATUS.PAUSED) return shop;
  if (shop.currentLoad >= shop.capacityPerDay) {
    return Object.assign({}, shop, { status: SHOP_STATUS.BUSY });
  }
  return Object.assign({}, shop, { status: SHOP_STATUS.AVAILABLE });
}

/** Apply auto-status to all shops and persist */
function pnRefreshAllShopStatuses() {
  const shops   = pnLoadShops().map(pnRefreshShopStatus);
  pnSaveShops(shops);
  return shops;
}

/* ====================================================
   ORDER HELPERS
   ==================================================== */

/** Create a new network order */
function pnCreateOrder(overrides = {}) {
  const now = new Date().toISOString();
  return Object.assign({
    orderId:            pnUid(),
    designId:           '',
    imageUrl:           '',
    prompt:             '',
    size:               '',
    qty:                1,
    productType:        'shirt',
    status:             ORDER_STATUS.NEW,
    assignedShopId:     null,
    finalPrinterShopId: null,
    forwardedByShopId:  null,
    totalPaid:          0,
    platformFee:        0,
    productionPayout:   0,
    createdAt:          now,
    updatedAt:          now,
    timeline:           [],
  }, overrides);
}

/** Add a timeline event to an order */
function pnAddTimelineEvent(order, event, shopId = null, note = '') {
  const entry = {
    event,
    shopId,
    note,
    timestamp: new Date().toISOString(),
  };
  return Object.assign({}, order, {
    timeline: [...(order.timeline || []), entry],
    updatedAt: new Date().toISOString(),
  });
}

/** Save or update an order */
function pnSaveOrder(orderData) {
  const orders = pnLoadOrders();
  const idx    = orders.findIndex(o => o.orderId === orderData.orderId);
  if (idx >= 0) {
    orders[idx] = Object.assign({}, orders[idx], orderData);
  } else {
    orders.push(orderData);
  }
  pnSaveOrders(orders);
  return orderData;
}

/** Get customer-facing status string */
function pnCustomerStatus(internalStatus) {
  return CUSTOMER_STATUS_MAP[internalStatus] || 'Order Received';
}

/* ====================================================
   ROUTING LOGIC
   Assigns a new order to the best available shop.
   Rules:
   1. Shop must support the product type.
   2. Shop must not be offline or paused.
   3. Prefer available over busy.
   4. Among equals, prefer lowest currentLoad.
   ==================================================== */
function pnRouteOrder(order) {
  const shops = pnRefreshAllShopStatuses();

  const eligible = shops.filter(s => {
    if (s.status === SHOP_STATUS.OFFLINE || s.status === SHOP_STATUS.PAUSED) return false;
    if (!(s.supportedProducts || []).includes(order.productType)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Sort: available first, then by load ascending
  eligible.sort((a, b) => {
    const statusScore = (s) => s.status === SHOP_STATUS.AVAILABLE ? 0 : 1;
    const scoreDiff = statusScore(a) - statusScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.currentLoad || 0) - (b.currentLoad || 0);
  });

  return eligible[0];
}

/**
 * Assign an order to the best shop.
 * Returns { order, shop } or { order, shop: null } if no shop found.
 */
function pnAssignOrder(order) {
  const bestShop = pnRouteOrder(order);

  let updatedOrder = Object.assign({}, order, {
    status:         bestShop ? ORDER_STATUS.ASSIGNED : ORDER_STATUS.NEW,
    assignedShopId: bestShop ? bestShop.shopId : null,
    updatedAt:      new Date().toISOString(),
  });

  if (bestShop) {
    updatedOrder = pnAddTimelineEvent(updatedOrder, 'assigned', bestShop.shopId,
      `Auto-assigned to ${bestShop.name}`);
    // Increment shop load
    const shops   = pnLoadShops();
    const shopIdx = shops.findIndex(s => s.shopId === bestShop.shopId);
    if (shopIdx >= 0) {
      shops[shopIdx].currentLoad = (shops[shopIdx].currentLoad || 0) + 1;
      pnSaveShops(shops);
    }
  }

  pnSaveOrder(updatedOrder);
  return { order: updatedOrder, shop: bestShop };
}

/* ====================================================
   SHOP ACTIONS (called from shop dashboard or admin)
   ==================================================== */

/**
 * Shop accepts an order.
 */
function pnAcceptOrder(orderId, shopId) {
  const orders = pnLoadOrders();
  let order    = orders.find(o => o.orderId === orderId);
  if (!order) return null;

  order = Object.assign({}, order, { status: ORDER_STATUS.ACCEPTED, updatedAt: new Date().toISOString() });
  order = pnAddTimelineEvent(order, 'accepted', shopId, 'Order accepted by shop');
  pnSaveOrder(order);
  return order;
}

/**
 * Shop marks order as in production.
 */
function pnStartProduction(orderId, shopId) {
  const orders = pnLoadOrders();
  let order    = orders.find(o => o.orderId === orderId);
  if (!order) return null;

  order = Object.assign({}, order, { status: ORDER_STATUS.IN_PRODUCTION, updatedAt: new Date().toISOString() });
  order = pnAddTimelineEvent(order, 'production_started', shopId, 'Production started');
  pnSaveOrder(order);
  return order;
}

/**
 * Shop marks order as completed.
 */
function pnCompleteOrder(orderId, shopId) {
  const orders = pnLoadOrders();
  let order    = orders.find(o => o.orderId === orderId);
  if (!order) return null;

  order = Object.assign({}, order, {
    status:             ORDER_STATUS.COMPLETED,
    finalPrinterShopId: shopId,
    updatedAt:          new Date().toISOString(),
  });
  order = pnAddTimelineEvent(order, 'completed', shopId, 'Order completed and shipped');

  // Decrement shop load on completion
  const shops   = pnLoadShops();
  const shopIdx = shops.findIndex(s => s.shopId === shopId);
  if (shopIdx >= 0) {
    shops[shopIdx].currentLoad = Math.max(0, (shops[shopIdx].currentLoad || 1) - 1);
    pnSaveShops(shops);
  }

  pnSaveOrder(order);
  return order;
}

/**
 * Shop forwards order to another approved shop.
 * @param {string} orderId
 * @param {string} fromShopId   - shop doing the forwarding
 * @param {string} toShopId     - target shop
 * @param {string} note         - optional forwarding note
 */
function pnForwardOrder(orderId, fromShopId, toShopId, note = '') {
  const orders = pnLoadOrders();
  let order    = orders.find(o => o.orderId === orderId);
  if (!order) return null;

  const shops     = pnLoadShops();
  const toShop    = shops.find(s => s.shopId === toShopId);
  const fromShop  = shops.find(s => s.shopId === fromShopId);
  if (!toShop) return null;

  order = Object.assign({}, order, {
    status:            ORDER_STATUS.FORWARDED,
    assignedShopId:    toShopId,
    forwardedByShopId: fromShopId,
    updatedAt:         new Date().toISOString(),
  });
  order = pnAddTimelineEvent(order, 'forwarded', fromShopId,
    `Forwarded from ${fromShop ? fromShop.name : fromShopId} to ${toShop.name}${note ? ': ' + note : ''}`);

  // Decrement from-shop load, increment to-shop load
  const fromIdx = shops.findIndex(s => s.shopId === fromShopId);
  const toIdx   = shops.findIndex(s => s.shopId === toShopId);
  if (fromIdx >= 0) shops[fromIdx].currentLoad = Math.max(0, (shops[fromIdx].currentLoad || 1) - 1);
  if (toIdx   >= 0) shops[toIdx].currentLoad   = (shops[toIdx].currentLoad || 0) + 1;
  pnSaveShops(shops);

  pnSaveOrder(order);
  return order;
}

/**
 * Decline / cancel an order.
 */
function pnDeclineOrder(orderId, shopId, reason = '') {
  const orders = pnLoadOrders();
  let order    = orders.find(o => o.orderId === orderId);
  if (!order) return null;

  // Decrement shop load
  const shops   = pnLoadShops();
  const shopIdx = shops.findIndex(s => s.shopId === shopId);
  if (shopIdx >= 0) {
    shops[shopIdx].currentLoad = Math.max(0, (shops[shopIdx].currentLoad || 1) - 1);
    pnSaveShops(shops);
  }

  order = Object.assign({}, order, {
    status:    ORDER_STATUS.CANCELLED,
    updatedAt: new Date().toISOString(),
  });
  order = pnAddTimelineEvent(order, 'cancelled', shopId,
    reason ? `Declined: ${reason}` : 'Declined by shop');
  pnSaveOrder(order);
  return order;
}

/* ====================================================
   DEMO SEED DATA
   ==================================================== */
function pnSeedDemoData() {
  const existingShops  = pnLoadShops();
  const existingOrders = pnLoadOrders();

  if (existingShops.length > 0) return { shops: existingShops, orders: existingOrders };

  const shops = [
    pnCreateShop({
      shopId: 'shop-001', name: 'Blended Prints — Main',
      email: 'orders@blendedprints.com', phone: '(555) 100-0001',
      address: 'Columbus, OH',
      supportedProducts: ['shirt', 'sticker', 'hoodie'],
      capacityPerDay: 30, currentLoad: 12,
      averageTurnaroundDays: 2, qualityScore: 96,
      status: SHOP_STATUS.AVAILABLE,
    }),
    pnCreateShop({
      shopId: 'shop-002', name: 'Midwest Tee Co.',
      email: 'print@midwesttee.com', phone: '(555) 200-0002',
      address: 'Cleveland, OH',
      supportedProducts: ['shirt', 'hoodie'],
      capacityPerDay: 20, currentLoad: 20,
      averageTurnaroundDays: 3, qualityScore: 88,
      status: SHOP_STATUS.BUSY,
    }),
    pnCreateShop({
      shopId: 'shop-003', name: 'StickerHouse LLC',
      email: 'hello@stickerhouse.io', phone: '(555) 300-0003',
      address: 'Cincinnati, OH',
      supportedProducts: ['sticker'],
      capacityPerDay: 50, currentLoad: 8,
      averageTurnaroundDays: 2, qualityScore: 94,
      status: SHOP_STATUS.AVAILABLE,
    }),
    pnCreateShop({
      shopId: 'shop-004', name: 'Prestige Print Works',
      email: 'ops@prestigeprint.com', phone: '(555) 400-0004',
      address: 'Dayton, OH',
      supportedProducts: ['shirt', 'sticker', 'hoodie'],
      capacityPerDay: 40, currentLoad: 0,
      averageTurnaroundDays: 4, qualityScore: 91,
      status: SHOP_STATUS.PAUSED,
    }),
  ];

  const now = Date.now();
  const orders = [
    pnCreateOrder({
      orderId: 'ord-001', designId: 'ai-design-abc123',
      imageUrl: '', prompt: 'Autism Walk 2026 bold design',
      size: '5"', qty: 42, productType: 'shirt',
      status: ORDER_STATUS.IN_PRODUCTION,
      assignedShopId: 'shop-001', finalPrinterShopId: null,
      totalPaid: 299.99, platformFee: 29.99, productionPayout: 270.00,
      createdAt: new Date(now - 86400000 * 3).toISOString(),
      timeline: [
        { event: 'assigned',           shopId: 'shop-001', note: 'Auto-assigned to Blended Prints — Main',  timestamp: new Date(now - 86400000*3).toISOString() },
        { event: 'accepted',           shopId: 'shop-001', note: 'Order accepted by shop',                  timestamp: new Date(now - 86400000*3 + 3600000).toISOString() },
        { event: 'production_started', shopId: 'shop-001', note: 'Production started',                      timestamp: new Date(now - 86400000*2).toISOString() },
      ],
    }),
    pnCreateOrder({
      orderId: 'ord-002', designId: 'ai-design-def456',
      imageUrl: '', prompt: 'Family Reunion 2026 matching shirts',
      size: '4"', qty: 18, productType: 'shirt',
      status: ORDER_STATUS.FORWARDED,
      assignedShopId: 'shop-001', forwardedByShopId: 'shop-002',
      totalPaid: 149.99, platformFee: 14.99, productionPayout: 135.00,
      createdAt: new Date(now - 86400000).toISOString(),
      timeline: [
        { event: 'assigned',  shopId: 'shop-002', note: 'Auto-assigned to Midwest Tee Co.',  timestamp: new Date(now - 86400000).toISOString() },
        { event: 'forwarded', shopId: 'shop-002', note: 'Forwarded from Midwest Tee Co. to Blended Prints — Main: At capacity today', timestamp: new Date(now - 82800000).toISOString() },
        { event: 'accepted',  shopId: 'shop-001', note: 'Order accepted by shop',             timestamp: new Date(now - 79200000).toISOString() },
      ],
    }),
    pnCreateOrder({
      orderId: 'ord-003', designId: 'ai-design-ghi789',
      imageUrl: '', prompt: 'Company Event bold logo sticker',
      size: '3"', qty: 100, productType: 'sticker',
      status: ORDER_STATUS.ACCEPTED,
      assignedShopId: 'shop-003',
      totalPaid: 89.99, platformFee: 8.99, productionPayout: 81.00,
      createdAt: new Date(now - 3600000 * 5).toISOString(),
      timeline: [
        { event: 'assigned', shopId: 'shop-003', note: 'Auto-assigned to StickerHouse LLC', timestamp: new Date(now - 3600000*5).toISOString() },
        { event: 'accepted', shopId: 'shop-003', note: 'Order accepted by shop',            timestamp: new Date(now - 3600000*4).toISOString() },
      ],
    }),
    pnCreateOrder({
      orderId: 'ord-004', designId: 'ai-design-jkl012',
      imageUrl: '', prompt: 'Youth football team jerseys',
      size: '5"', qty: 25, productType: 'shirt',
      status: ORDER_STATUS.NEW,
      assignedShopId: null,
      totalPaid: 199.99, platformFee: 19.99, productionPayout: 180.00,
      createdAt: new Date(now - 1800000).toISOString(),
      timeline: [],
    }),
    pnCreateOrder({
      orderId: 'ord-005', designId: 'ai-design-mno345',
      imageUrl: '', prompt: 'Fire Dept — Engine 7 shirt',
      size: '5"', qty: 12, productType: 'shirt',
      status: ORDER_STATUS.COMPLETED,
      assignedShopId: 'shop-001', finalPrinterShopId: 'shop-001',
      totalPaid: 124.99, platformFee: 12.49, productionPayout: 112.50,
      createdAt: new Date(now - 86400000 * 7).toISOString(),
      timeline: [
        { event: 'assigned',           shopId: 'shop-001', note: 'Auto-assigned',    timestamp: new Date(now - 86400000*7).toISOString() },
        { event: 'accepted',           shopId: 'shop-001', note: 'Accepted',         timestamp: new Date(now - 86400000*7 + 3600000).toISOString() },
        { event: 'production_started', shopId: 'shop-001', note: 'In production',    timestamp: new Date(now - 86400000*6).toISOString() },
        { event: 'completed',          shopId: 'shop-001', note: 'Shipped to customer', timestamp: new Date(now - 86400000*5).toISOString() },
      ],
    }),
  ];

  pnSaveShops(shops);
  pnSaveOrders(orders);
  return { shops, orders };
}

/* ====================================================
   EXPORTS (global — used by network.html and admin.html)
   ==================================================== */
const PrintPathNetwork = {
  // Constants
  SHOP_STATUS,
  ORDER_STATUS,
  CUSTOMER_STATUS_MAP,

  // Data
  loadShops:   pnLoadShops,
  saveShops:   pnSaveShops,
  loadOrders:  pnLoadOrders,
  saveOrders:  pnSaveOrders,

  // Shop ops
  createShop:              pnCreateShop,
  saveShop:                pnSaveShop,
  deleteShop:              pnDeleteShop,
  refreshShopStatus:       pnRefreshShopStatus,
  refreshAllShopStatuses:  pnRefreshAllShopStatuses,

  // Order ops
  createOrder:    pnCreateOrder,
  saveOrder:      pnSaveOrder,
  addTimeline:    pnAddTimelineEvent,
  customerStatus: pnCustomerStatus,

  // Actions
  routeOrder:      pnRouteOrder,
  assignOrder:     pnAssignOrder,
  acceptOrder:     pnAcceptOrder,
  startProduction: pnStartProduction,
  completeOrder:   pnCompleteOrder,
  forwardOrder:    pnForwardOrder,
  declineOrder:    pnDeclineOrder,

  // Utils
  uid:      pnUid,
  seedDemo: pnSeedDemoData,
};
