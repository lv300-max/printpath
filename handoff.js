/* ============================================================
   PrintPath — Print Handoff System
   Builds structured order payloads and redirect URLs for
   any custom print item (stickers, shirts, banners, etc.)
   Works alongside sticker.js and app.js — no dependencies.
   ============================================================ */

'use strict';

/* ====================================================
   HANDOFF CONFIG
   Edit ONLY this block to configure your handoff.
   ==================================================== */
const HANDOFF_CONFIG = {
  // Your friend's order intake URL — change this one line
  partnerBaseUrl:  'https://FRIEND-DOMAIN.com/order-intake',

  // Referral / tracking param added to every redirect
  ref:             'luis_store',

  // Optional commission/affiliate code (leave empty to omit)
  commissionCode:  '',

  // Your store name — sent as "source" param
  sourceStore:     'PrintPath',

  // localStorage key for outgoing order log
  orderLogKey:     'td-outgoing-orders',

  // Maximum entries kept in local log
  orderLogMax:     50,
};

/* ====================================================
   ORDER PAYLOAD BUILDER
   Constructs a clean, typed order object.
   All fields are explicit — easy to extend.
   ==================================================== */

/**
 * buildPrintOrder(options) → OrderPayload object
 *
 * Supported orderTypes (extend freely):
 *   "custom_sticker" | "custom_shirt" | "banner" | "decal" | "label"
 *
 * @param {object} opts
 * @param {string}  opts.orderType       - product type
 * @param {string}  opts.designId        - unique design identifier
 * @param {string}  opts.previewImage    - low-res preview URL (data URL or blob URL)
 * @param {string}  opts.printReadyImage - high-res print-ready URL (blob URL or data URL)
 * @param {number}  opts.widthInches     - print width in inches
 * @param {number}  opts.heightInches    - print height in inches
 * @param {number}  opts.dpi             - resolution of the print-ready file
 * @param {number}  opts.quantity        - number of units
 * @param {string}  [opts.finish]        - "matte" | "gloss" | "" (placeholder)
 * @param {string}  [opts.cutType]       - "die_cut" | "circle" | "square" | "kiss_cut" | ""
 * @param {string}  [opts.notes]         - customer notes
 * @returns {object} OrderPayload
 */
function buildPrintOrder(opts) {
  return {
    // Identity
    orderType:       opts.orderType       || 'custom_print',
    designId:        opts.designId        || ('design-' + Date.now()),
    sourceStore:     HANDOFF_CONFIG.sourceStore,

    // Images
    previewImage:    opts.previewImage    || '',
    printReadyImage: opts.printReadyImage || '',

    // Dimensions
    widthInches:     Number(opts.widthInches)  || 0,
    heightInches:    Number(opts.heightInches) || 0,
    dpi:             Number(opts.dpi)          || 0,

    // Order details
    quantity:        Math.max(1, Number(opts.quantity) || 1),
    finish:          opts.finish   || 'matte',    // placeholder — customer can confirm on partner site
    cutType:         opts.cutType  || 'die_cut',  // placeholder
    notes:           opts.notes    || '',

    // Tracking
    ref:             HANDOFF_CONFIG.ref,
    commissionCode:  HANDOFF_CONFIG.commissionCode,

    // Internal metadata
    createdAt:       new Date().toISOString(),
  };
}

/* ====================================================
   VALIDATION
   Returns { valid: bool, errors: string[] }
   ==================================================== */
function validatePrintOrder(order) {
  const errors = [];

  if (!order.previewImage)
    errors.push('No preview image — upload your design first.');
  if (!order.printReadyImage)
    errors.push('No print-ready file — click "Download PNG" or add to cart to generate it.');
  if (!order.dpi || order.dpi < 300)
    errors.push(`Minimum 300 DPI required. Your design is ${order.dpi || 0} DPI.`);
  if (!order.widthInches || !order.heightInches)
    errors.push('Print size not set — choose a size before continuing.');
  if (!order.quantity || order.quantity < 1)
    errors.push('Quantity must be at least 1.');

  return { valid: errors.length === 0, errors };
}

/* ====================================================
   URL BUILDER
   Converts an OrderPayload into a safe redirect URL.
   ==================================================== */
function buildHandoffUrl(order) {
  const base   = HANDOFF_CONFIG.partnerBaseUrl;
  const params = new URLSearchParams();

  // Core order params (short names for clean URLs)
  params.set('type',    order.orderType);
  params.set('id',      order.designId);
  params.set('preview', order.previewImage);
  params.set('file',    order.printReadyImage);
  params.set('w',       order.widthInches);
  params.set('h',       order.heightInches);
  params.set('dpi',     order.dpi);
  params.set('qty',     order.quantity);
  params.set('finish',  order.finish);
  params.set('cut',     order.cutType);
  params.set('source',  order.sourceStore);

  // Optional fields — only include if non-empty
  if (order.notes)          params.set('notes',    order.notes);
  if (order.ref)            params.set('ref',       order.ref);
  if (order.commissionCode) params.set('cc',        order.commissionCode);

  // URLSearchParams handles encodeURIComponent internally
  return `${base}?${params.toString()}`;
}

/* ====================================================
   LOCAL ORDER LOG
   Saves a lightweight record to localStorage before
   the user leaves the site.
   ==================================================== */
function logOutgoingOrder(order, redirectUrl) {
  let log = [];
  try {
    log = JSON.parse(localStorage.getItem(HANDOFF_CONFIG.orderLogKey) || '[]');
  } catch (_) { log = []; }

  // Trim log to max size
  if (log.length >= HANDOFF_CONFIG.orderLogMax) {
    log = log.slice(log.length - HANDOFF_CONFIG.orderLogMax + 1);
  }

  log.push({
    timestamp:   new Date().toISOString(),
    designId:    order.designId,
    orderType:   order.orderType,
    previewImage:order.previewImage,
    quantity:    order.quantity,
    widthInches: order.widthInches,
    heightInches:order.heightInches,
    dpi:         order.dpi,
    finish:      order.finish,
    cutType:     order.cutType,
    notes:       order.notes   || '',
    ref:         order.ref     || '',
    sourceStore: order.sourceStore || '',
    status:      'sent',   // "sent" | "fulfilled" | "cancelled" — update manually in admin
    redirectUrl,
  });

  try {
    localStorage.setItem(HANDOFF_CONFIG.orderLogKey, JSON.stringify(log));
  } catch (e) {
    console.warn('[PrintPath] Could not save order log:', e);
  }
}

/* ====================================================
   MAIN HANDOFF ENTRY POINT
   Call this when the customer clicks "Continue to Print Shop".

   1. Validates the order
   2. Logs it locally
   3. Redirects to partner URL

   Returns { valid, errors } so the caller can show UI feedback.
   ==================================================== */
function executeHandoff(order) {
  const { valid, errors } = validatePrintOrder(order);

  if (!valid) {
    return { valid: false, errors };
  }

  const url = buildHandoffUrl(order);

  // Save to local log before leaving
  logOutgoingOrder(order, url);

  // Small delay so toast/UI can update before navigation
  setTimeout(() => { window.location.href = url; }, 600);

  return { valid: true, errors: [], redirectUrl: url };
}

/* ====================================================
   RETRIEVE LOCAL ORDER LOG (for debugging / admin)
   ==================================================== */
function getOrderLog() {
  try {
    return JSON.parse(localStorage.getItem(HANDOFF_CONFIG.orderLogKey) || '[]');
  } catch (_) {
    return [];
  }
}

function clearOrderLog() {
  localStorage.removeItem(HANDOFF_CONFIG.orderLogKey);
}

/**
 * updateOrderStatus(designId, newStatus)
 * Updates the status of a logged order by designId.
 * Valid statuses: "sent" | "fulfilled" | "cancelled"
 */
function updateOrderStatus(designId, newStatus) {
  let log = getOrderLog();
  let updated = false;
  log = log.map(entry => {
    if (entry.designId === designId) {
      updated = true;
      return Object.assign({}, entry, { status: newStatus });
    }
    return entry;
  });
  if (updated) {
    try {
      localStorage.setItem(HANDOFF_CONFIG.orderLogKey, JSON.stringify(log));
    } catch (e) {
      console.warn('[PrintPath] Could not update order status:', e);
    }
  }
  return updated;
}
