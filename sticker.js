/* ============================================================
   PrintPath — Sticker Lab
   Canvas-based sticker designer with DPI validation,
   transform controls, export to PNG, and cart integration.
   ============================================================ */

'use strict';

/* ====================================================
   STICKER CONFIG — edit to customise
   ==================================================== */
const STICKER_CONFIG = {
  // Change this to your print partner's order URL
  // Items are appended as query params when cart contains a sticker
  partnerOrderUrl: 'https://your-friend-shop.com/order',

  minDpi: 300,

  sizes: [
    { label: '2 × 2 in',  w: 2, h: 2 },
    { label: '3 × 3 in',  w: 3, h: 3 },
    { label: '4 × 4 in',  w: 4, h: 4 },
    { label: 'Custom…',   w: 0, h: 0, custom: true },
  ],

  // Canvas display size (CSS pixels)
  canvasDisplaySize: 420,
};

/* ====================================================
   STICKER STATE
   ==================================================== */
const stickerState = {
  open: false,

  // Uploaded image
  image: null,          // HTMLImageElement
  imageUrl: null,       // Object URL
  imageNaturalW: 0,
  imageNaturalH: 0,

  // Selected print size
  sizeIndex: 0,
  customW: 3,
  customH: 3,

  // Transform (in canvas coords)
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,          // degrees

  // Interaction
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0,

  // DPI validation result
  dpiOk: false,
  dpiValue: 0,

  // Export
  exportUrl: null,      // blob URL of final PNG
  exportBlob: null,

  // Quantity for cart
  qty: 1,
};

/* ====================================================
   DOM REFERENCES (resolved lazily after HTML is in DOM)
   ==================================================== */
let sl = {};   // sticker lab dom refs

function slRefs() {
  sl = {
    overlay:       document.getElementById('sticker-lab-overlay'),
    navBtn:        document.getElementById('sticker-lab-nav-btn'),
    closeBtn:      document.getElementById('sl-close'),
    backBtn:       document.getElementById('sl-back-btn'),

    uploadBtn:     document.getElementById('sl-upload-btn'),
    fileInput:     document.getElementById('sl-file-input'),
    uploadZone:    document.getElementById('sl-upload-zone'),

    canvas:        document.getElementById('sl-canvas'),
    canvasWrap:    document.getElementById('sl-canvas-wrap'),

    sizeSelect:    document.getElementById('sl-size-select'),
    customFields:  document.getElementById('sl-custom-fields'),
    customW:       document.getElementById('sl-custom-w'),
    customH:       document.getElementById('sl-custom-h'),

    scaleSlider:   document.getElementById('sl-scale'),
    scaleValue:    document.getElementById('sl-scale-value'),
    rotSlider:     document.getElementById('sl-rot'),
    rotValue:      document.getElementById('sl-rot-value'),

    dpiStatus:     document.getElementById('sl-dpi-status'),
    dpiValue:      document.getElementById('sl-dpi-value'),
    dimensionsInfo:document.getElementById('sl-dimensions'),

    errorBox:      document.getElementById('sl-error-box'),

    exportBtn:     document.getElementById('sl-export-btn'),
    addCartBtn:    document.getElementById('sl-add-cart-btn'),
    sendPrintBtn:  document.getElementById('sl-send-print-btn'),

    qtyDec:        document.getElementById('sl-qty-dec'),
    qtyInc:        document.getElementById('sl-qty-inc'),
    qtyVal:        document.getElementById('sl-qty-val'),

    previewThumb:  document.getElementById('sl-preview-thumb'),
  };
}

/* ====================================================
   OPEN / CLOSE
   ==================================================== */
function openStickerLab() {
  slRefs();
  stickerState.open = true;

  // Native-feel entrance
  if (typeof PP !== 'undefined') {
    const modal = sl.overlay.querySelector('.sl-modal');
    PP.openOverlay(sl.overlay, modal, 'center');
  } else {
    sl.overlay.style.display = 'flex';
  }
  document.body.style.overflow = 'hidden';
  history.pushState({ page: 'stickerlab' }, '', '#sticker-lab');
  slInitCanvas();
  slBindEvents();
  slPopulateSizes();
  slRender();
}

function closeStickerLab() {
  if (!stickerState.open) return;
  stickerState.open = false;

  if (typeof PP !== 'undefined') {
    const modal = sl.overlay.querySelector('.sl-modal');
    PP.closeOverlay(sl.overlay, modal, () => {
      document.body.style.overflow = '';
    });
  } else {
    sl.overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

/* ====================================================
   SIZE OPTIONS
   ==================================================== */
function slPopulateSizes() {
  sl.sizeSelect.innerHTML = STICKER_CONFIG.sizes.map((s, i) =>
    `<option value="${i}">${s.label}</option>`
  ).join('');
  sl.sizeSelect.value = stickerState.sizeIndex;
  slUpdateCustomVisibility();
}

function slGetPrintSize() {
  const s = STICKER_CONFIG.sizes[stickerState.sizeIndex];
  if (s.custom) {
    return {
      w: parseFloat(sl.customW.value) || 3,
      h: parseFloat(sl.customH.value) || 3,
    };
  }
  return { w: s.w, h: s.h };
}

function slUpdateCustomVisibility() {
  const s = STICKER_CONFIG.sizes[stickerState.sizeIndex];
  sl.customFields.style.display = s.custom ? 'flex' : 'none';
}

/* ====================================================
   CANVAS INIT + RENDER
   ==================================================== */
function slInitCanvas() {
  const size = STICKER_CONFIG.canvasDisplaySize;
  sl.canvas.width  = size;
  sl.canvas.height = size;
  sl.canvas.style.width  = size + 'px';
  sl.canvas.style.height = size + 'px';
}

function slRender() {
  if (!sl.canvas) return;
  const ctx  = sl.canvas.getContext('2d');
  const size = STICKER_CONFIG.canvasDisplaySize;

  // Clear with transparent background
  ctx.clearRect(0, 0, size, size);

  // Dashed boundary circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.35)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  if (!stickerState.image) {
    // Placeholder text
    ctx.save();
    ctx.fillStyle = 'rgba(124, 58, 237, 0.12)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(124, 58, 237, 0.5)';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Upload an image to start', size / 2, size / 2);
    ctx.restore();
    return;
  }

  // Draw image with transforms
  const img = stickerState.image;
  const cx  = size / 2 + stickerState.x;
  const cy  = size / 2 + stickerState.y;

  // Clip to circle so sticker stays round
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(cx, cy);
  ctx.rotate((stickerState.rotation * Math.PI) / 180);
  ctx.scale(stickerState.scale, stickerState.scale);

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  // Fit image to canvas on first draw — cover style
  const baseScale = Math.max(size / iw, size / ih);
  const dw = iw * baseScale;
  const dh = ih * baseScale;

  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/* ====================================================
   IMAGE UPLOAD + DPI CHECK
   ==================================================== */
function slHandleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    slShowError('Please upload a valid image file (JPEG, PNG, WebP).');
    return;
  }

  // Revoke previous URL
  if (stickerState.imageUrl) URL.revokeObjectURL(stickerState.imageUrl);

  const url = URL.createObjectURL(file);
  stickerState.imageUrl = url;

  const img = new Image();
  img.onload = () => {
    stickerState.image         = img;
    stickerState.imageNaturalW = img.naturalWidth;
    stickerState.imageNaturalH = img.naturalHeight;
    stickerState.x             = 0;
    stickerState.y             = 0;
    stickerState.scale         = 1;
    stickerState.rotation      = 0;
    stickerState.exportUrl     = null;
    stickerState.exportBlob    = null;

    sl.scaleSlider.value = 100;
    sl.rotSlider.value   = 0;
    sl.scaleValue.textContent = '100%';
    sl.rotValue.textContent   = '0°';

    slHideError();
    slCheckDpi();
    slRender();
    slUpdatePreview();
  };
  img.onerror = () => slShowError('Could not read this image file. Try a different one.');
  img.src = url;
}

function slCheckDpi() {
  if (!stickerState.image) return;

  const { w, h } = slGetPrintSize();
  const pw = stickerState.imageNaturalW;
  const ph = stickerState.imageNaturalH;

  // Use the smaller axis to be conservative
  const dpiW = pw / w;
  const dpiH = ph / h;
  const dpi  = Math.min(dpiW, dpiH);

  stickerState.dpiValue = Math.round(dpi);

  const printW = (pw / STICKER_CONFIG.minDpi).toFixed(2);
  const printH = (ph / STICKER_CONFIG.minDpi).toFixed(2);

  sl.dpiValue.textContent  = stickerState.dpiValue + ' DPI';
  sl.dimensionsInfo.textContent =
    `Image: ${pw} × ${ph} px  ·  Print at 300 DPI: ${printW}" × ${printH}"`;

  if (dpi < STICKER_CONFIG.minDpi) {
    stickerState.dpiOk = false;
    sl.dpiStatus.className   = 'sl-dpi-badge fail';
    sl.dpiStatus.textContent = '✕ Too low';
    slShowError(
      `Your image is too low quality for ${w}" × ${h}" at 300 DPI.\n` +
      `Minimum 300 DPI required — your image gives ~${stickerState.dpiValue} DPI.\n` +
      `Upload a higher-resolution image, or choose a smaller print size.`
    );
    sl.addCartBtn.disabled   = true;
    sl.exportBtn.disabled    = true;
    if (sl.sendPrintBtn) sl.sendPrintBtn.disabled = true;
  } else {
    stickerState.dpiOk = true;
    sl.dpiStatus.className   = 'sl-dpi-badge pass';
    sl.dpiStatus.textContent = '✓ 300 DPI OK';
    slHideError();
    sl.addCartBtn.disabled   = false;
    sl.exportBtn.disabled    = false;
    if (sl.sendPrintBtn) sl.sendPrintBtn.disabled = false;
  }
}

/* ====================================================
   EXPORT — generate print-ready PNG
   ==================================================== */
function slExport(callback) {
  if (!stickerState.image || !stickerState.dpiOk) return;

  const { w, h } = slGetPrintSize();
  const px = w * STICKER_CONFIG.minDpi;   // e.g. 3" × 300 = 900px
  const py = h * STICKER_CONFIG.minDpi;

  const offscreen = document.createElement('canvas');
  offscreen.width  = px;
  offscreen.height = py;
  const ctx = offscreen.getContext('2d');

  // Transparent background (for round die-cut stickers)
  ctx.clearRect(0, 0, px, py);

  // Clip to circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(px / 2, py / 2, Math.min(px, py) / 2, 0, Math.PI * 2);
  ctx.clip();

  // Scale from display-canvas coords to print-canvas coords
  const displaySize = STICKER_CONFIG.canvasDisplaySize;
  const scaleRatio  = px / displaySize;

  const img = stickerState.image;
  const iw  = img.naturalWidth;
  const ih  = img.naturalHeight;
  const baseScale = Math.max(displaySize / iw, displaySize / ih);
  const dw  = iw * baseScale * stickerState.scale * scaleRatio;
  const dh  = ih * baseScale * stickerState.scale * scaleRatio;

  const cx  = px / 2 + stickerState.x * scaleRatio;
  const cy  = py / 2 + stickerState.y * scaleRatio;

  ctx.translate(cx, cy);
  ctx.rotate((stickerState.rotation * Math.PI) / 180);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  offscreen.toBlob(blob => {
    if (stickerState.exportUrl) URL.revokeObjectURL(stickerState.exportUrl);
    stickerState.exportBlob = blob;
    stickerState.exportUrl  = URL.createObjectURL(blob);
    if (typeof callback === 'function') callback(stickerState.exportUrl);
  }, 'image/png');
}

function slDownload() {
  slExport(url => {
    const a  = document.createElement('a');
    a.href   = url;
    const { w, h } = slGetPrintSize();
    a.download = `sticker-${w}x${h}-300dpi.png`;
    a.click();
    showToast('🎨 Sticker exported — ready to print!', 'success');
  });
}

/* ====================================================
   PREVIEW THUMBNAIL (shown in cart)
   ==================================================== */
function slUpdatePreview() {
  if (!sl.previewThumb) return;
  const url = stickerState.exportUrl || stickerState.imageUrl;
  if (url) {
    sl.previewThumb.src = url;
    sl.previewThumb.style.display = 'block';
  }
}

/* ====================================================
   ADD TO CART
   ==================================================== */
function slAddToCart() {
  if (!stickerState.image) {
    showToast('Upload an image first!', 'warning');
    return;
  }
  if (!stickerState.dpiOk) {
    showToast('Fix DPI issues before adding to cart.', 'warning');
    return;
  }

  slExport(exportUrl => {
    const { w, h }  = slGetPrintSize();
    const sizeLabel = `${w}" \u00d7 ${h}"`;
    const qty       = stickerState.qty;
    const key       = `sticker-${Date.now()}`;

    const stickerItem = {
      key,
      id:             'custom-sticker',
      name:           `Custom Sticker (${sizeLabel})`,
      price:          slCalcPrice(w, h),
      image:          exportUrl,
      size:           sizeLabel,
      color:          null,
      qty,
      custom_sticker: true,
      exportUrl,
      printW:         w,
      printH:         h,
      dpi:            stickerState.dpiValue,
      finish:         reviewState.finish,
      cutType:        reviewState.cutType,
    };

    state.cart.push(stickerItem);
    saveCartToStorage();
    renderCart();
    updateCartCount(true);
    openCart();
    closeStickerLab();
    showToast(`\uD83C\uDFA8 Sticker (${sizeLabel}) added to cart!`, 'success');
  });
}

/* Simple price table — adjust as needed */
function slCalcPrice(w, h) {
  const area = w * h;
  if (area <= 4)  return 4.99;   // 2×2
  if (area <= 9)  return 6.99;   // 3×3
  if (area <= 16) return 9.99;   // 4×4
  return 12.99;
}

/* ====================================================
   REVIEW PANEL — open before redirect to print shop
   ==================================================== */

// Tracks current order options chosen in the review panel
const reviewState = {
  finish:  'matte',
  cutType: 'die_cut',
  order:   null,   // the pending PrintOrder object
};

function openReviewPanel() {
  if (!stickerState.image) {
    showToast('Upload an image first!', 'warning');
    return;
  }
  if (!stickerState.dpiOk) {
    showToast('Fix DPI issues before continuing.', 'warning');
    return;
  }

  // Generate export first, then open panel
  slExport(exportUrl => {
    const { w, h } = slGetPrintSize();

    // Build the order payload via handoff.js
    const order = buildPrintOrder({
      orderType:       'custom_sticker',
      designId:        'sticker-' + Date.now(),
      previewImage:    stickerState.imageUrl  || exportUrl,
      printReadyImage: exportUrl,
      widthInches:     w,
      heightInches:    h,
      dpi:             stickerState.dpiValue,
      quantity:        stickerState.qty,
      finish:          reviewState.finish,
      cutType:         reviewState.cutType,
      notes:           '',
    });

    reviewState.order = order;

    // Populate the panel
    const rpOverlay  = document.getElementById('review-panel-overlay');
    const rpPreview  = document.getElementById('rp-preview-img');
    const rpBadge    = document.getElementById('rp-print-badge');
    const rpType     = document.getElementById('rp-type');
    const rpSize     = document.getElementById('rp-size');
    const rpDpi      = document.getElementById('rp-dpi');
    const rpQty      = document.getElementById('rp-qty');
    const rpFinish   = document.getElementById('rp-finish');
    const rpCut      = document.getElementById('rp-cut');
    const rpErrBox   = document.getElementById('rp-error-box');
    const rpNotesInp = document.getElementById('rp-notes-input');

    rpPreview.src = exportUrl;

    // Validate and set badge
    const { valid, errors } = validatePrintOrder(order);
    if (valid) {
      rpBadge.textContent  = '✓ Print Ready';
      rpBadge.className    = 'rp-print-badge pass';
      rpErrBox.style.display = 'none';
      document.getElementById('rp-confirm-btn').disabled = false;
    } else {
      rpBadge.textContent  = '✕ Fix Design First';
      rpBadge.className    = 'rp-print-badge fail';
      rpErrBox.style.display  = 'block';
      rpErrBox.innerHTML   = errors.map(e => `• ${e}`).join('<br>');
      document.getElementById('rp-confirm-btn').disabled = true;
    }

    rpType.textContent   = 'Custom Sticker';
    rpSize.textContent   = `${w}" × ${h}"`;
    rpDpi.textContent    = order.dpi + ' DPI';
    rpQty.textContent    = order.quantity;
    rpFinish.textContent = order.finish.charAt(0).toUpperCase() + order.finish.slice(1);
    rpCut.textContent    = order.cutType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    rpNotesInp.value     = '';

    // Reset finish/cut pickers to current state
    document.querySelectorAll('#rp-finish-picker .pill').forEach(b =>
      b.classList.toggle('active', b.dataset.finish === reviewState.finish));
    document.querySelectorAll('#rp-cut-picker .pill').forEach(b =>
      b.classList.toggle('active', b.dataset.cut === reviewState.cutType));

    // Show panel
    rpOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Bind panel events once
    rpBindEvents();
  });
}

function closeReviewPanel() {
  const rpOverlay = document.getElementById('review-panel-overlay');
  if (rpOverlay) rpOverlay.style.display = 'none';
  document.body.style.overflow = 'hidden'; // sticker lab is still open underneath
}

function rpSelectFinish(btn, finish) {
  reviewState.finish = finish;
  document.querySelectorAll('#rp-finish-picker .pill').forEach(b =>
    b.classList.toggle('active', b === btn));
  if (reviewState.order) reviewState.order.finish = finish;
  const el = document.getElementById('rp-finish');
  if (el) el.textContent = finish.charAt(0).toUpperCase() + finish.slice(1);
}

function rpSelectCut(btn, cut) {
  reviewState.cutType = cut;
  document.querySelectorAll('#rp-cut-picker .pill').forEach(b =>
    b.classList.toggle('active', b === btn));
  if (reviewState.order) reviewState.order.cutType = cut;
  const el = document.getElementById('rp-cut');
  if (el) el.textContent = cut.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

let rpEventsBound = false;
function rpBindEvents() {
  if (rpEventsBound) return;
  rpEventsBound = true;

  document.getElementById('rp-close').addEventListener('click', closeReviewPanel);
  document.getElementById('rp-back-edit').addEventListener('click', closeReviewPanel);

  document.getElementById('review-panel-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('review-panel-overlay')) closeReviewPanel();
  });

  document.getElementById('rp-confirm-btn').addEventListener('click', () => {
    const order = reviewState.order;
    if (!order) return;

    // Pick up latest notes
    order.notes = (document.getElementById('rp-notes-input').value || '').trim();
    // Pick up latest finish/cut
    order.finish  = reviewState.finish;
    order.cutType = reviewState.cutType;

    const result = executeHandoff(order);

    if (!result.valid) {
      const box = document.getElementById('rp-error-box');
      box.style.display = 'block';
      box.innerHTML = result.errors.map(e => `• ${e}`).join('<br>');
      return;
    }

    showToast('Sending you to the print shop\u2026', 'success');
  });
}

/* ====================================================
   ALSO ADD TO CART (keeps cart flow working)
   Opens review panel on the "Continue to Print Shop" path.
   Cart add flow is separate (quick cart for tracking).
   ==================================================== */

/* ====================================================
   ERROR DISPLAY
   ==================================================== */
function slShowError(msg) {
  sl.errorBox.style.display = 'block';
  // Replace newlines with <br> for multi-line
  sl.errorBox.innerHTML = msg.replace(/\n/g, '<br>');
}

function slHideError() {
  sl.errorBox.style.display = 'none';
  sl.errorBox.textContent   = '';
}

/* ====================================================
   DRAG TO MOVE IMAGE
   ==================================================== */
function slStartDrag(e) {
  if (!stickerState.image) return;
  stickerState.dragging    = true;
  const pt = slEventPoint(e);
  stickerState.dragStartX  = pt.x;
  stickerState.dragStartY  = pt.y;
  stickerState.dragOriginX = stickerState.x;
  stickerState.dragOriginY = stickerState.y;
  sl.canvas.style.cursor   = 'grabbing';
  e.preventDefault();
}

function slMoveDrag(e) {
  if (!stickerState.dragging) return;
  const pt = slEventPoint(e);
  stickerState.x = stickerState.dragOriginX + (pt.x - stickerState.dragStartX);
  stickerState.y = stickerState.dragOriginY + (pt.y - stickerState.dragStartY);
  slRender();
  e.preventDefault();
}

function slEndDrag() {
  stickerState.dragging  = false;
  sl.canvas.style.cursor = stickerState.image ? 'grab' : 'default';
}

function slEventPoint(e) {
  if (e.touches) {
    const t = e.touches[0];
    const r = sl.canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  const r = sl.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/* ====================================================
   BIND EVENTS (called once when overlay opens)
   ==================================================== */
let slEventsBound = false;
function slBindEvents() {
  if (slEventsBound) return;
  slEventsBound = true;

  // Close / back
  sl.closeBtn.addEventListener('click', closeStickerLab);
  sl.backBtn.addEventListener('click', closeStickerLab);
  sl.overlay.addEventListener('click', e => {
    if (e.target === sl.overlay) closeStickerLab();
  });

  // File upload — button click
  sl.uploadBtn.addEventListener('click', () => sl.fileInput.click());

  // File input change
  sl.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) slHandleFile(e.target.files[0]);
  });

  // Drag-and-drop onto upload zone
  sl.uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    sl.uploadZone.classList.add('drag-over');
  });
  sl.uploadZone.addEventListener('dragleave', () =>
    sl.uploadZone.classList.remove('drag-over'));
  sl.uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    sl.uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) slHandleFile(e.dataTransfer.files[0]);
  });

  // Size selector
  sl.sizeSelect.addEventListener('change', () => {
    stickerState.sizeIndex = parseInt(sl.sizeSelect.value, 10);
    slUpdateCustomVisibility();
    slCheckDpi();
    slRender();
  });

  // Custom size
  [sl.customW, sl.customH].forEach(input => {
    input.addEventListener('input', () => {
      slCheckDpi();
    });
  });

  // Scale slider
  sl.scaleSlider.addEventListener('input', () => {
    stickerState.scale = parseInt(sl.scaleSlider.value, 10) / 100;
    sl.scaleValue.textContent = sl.scaleSlider.value + '%';
    slRender();
  });

  // Rotation slider
  sl.rotSlider.addEventListener('input', () => {
    stickerState.rotation = parseInt(sl.rotSlider.value, 10);
    sl.rotValue.textContent = stickerState.rotation + '°';
    slRender();
  });

  // Canvas — drag to move
  sl.canvas.addEventListener('mousedown',  slStartDrag);
  sl.canvas.addEventListener('mousemove',  slMoveDrag);
  sl.canvas.addEventListener('mouseup',    slEndDrag);
  sl.canvas.addEventListener('mouseleave', slEndDrag);
  sl.canvas.addEventListener('touchstart', slStartDrag, { passive: false });
  sl.canvas.addEventListener('touchmove',  slMoveDrag,  { passive: false });
  sl.canvas.addEventListener('touchend',   slEndDrag);

  // Export button
  sl.exportBtn.addEventListener('click', slDownload);

  // Add to cart
  sl.addCartBtn.addEventListener('click', slAddToCart);

  // Send to print shop button (if present)
  const sendBtn = document.getElementById('sl-send-print-btn');
  if (sendBtn) sendBtn.addEventListener('click', openReviewPanel);

  // Quantity
  sl.qtyDec.addEventListener('click', () => {
    stickerState.qty = Math.max(1, stickerState.qty - 1);
    sl.qtyVal.textContent = stickerState.qty;
  });
  sl.qtyInc.addEventListener('click', () => {
    stickerState.qty = Math.min(99, stickerState.qty + 1);
    sl.qtyVal.textContent = stickerState.qty;
  });

  // Keyboard Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stickerState.open) closeStickerLab();
  });
}
