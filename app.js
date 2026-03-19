/* ============================================================
   PrintPath — Main Application Script
   Vanilla JS SPA: cart, checkout, design lab, AI gen, sticker lab
   ============================================================ */

'use strict';

/* ====================================================
   STATE
   ==================================================== */
const state = {
  products: [],
  cart: [],
  theme: localStorage.getItem('td-theme') || 'light',
  deferredInstallPrompt: null,
  // Design Lab
  dlProduct: null,
  dlSelectedSize: null,
  dlSelectedColor: null,
  dlView: 'front',
  dlZoomed: false,
};

/* ====================================================
   HYPE BANNER MESSAGES — edit to customize ticker
   ==================================================== */
const HYPE_MESSAGES = [
  { icon: '⚡', text: 'AI-powered designs — print-ready in seconds' },
  { icon: '🎯', text: '300 DPI guaranteed on every design' },
  { icon: '🚚', text: 'Free shipping on orders over $75' },
  { icon: '✦', text: 'New designs every time you create' },
  { icon: '↩️', text: '30-day hassle-free returns' },
  { icon: '⬡', text: 'PrintPath: Design it. We make it print-perfect.' },
  { icon: '🔒', text: 'Secure checkout powered by Stripe' },
];

/* ====================================================
   STRIPE CONFIG (replace with your actual keys)
   ==================================================== */
const STRIPE_CONFIG = {
  publishableKey: 'pk_test_YOUR_STRIPE_PUBLISHABLE_KEY_HERE',
  // In production, your server creates a Checkout Session
  // and returns a session ID to redirect to.
  successUrl: `${window.location.origin}/?checkout=success`,
  cancelUrl:  `${window.location.origin}/?checkout=cancel`,
};

/* ====================================================
   COLOR MAP — name → hex/css
   ==================================================== */
const COLOR_MAP = {
  White:  '#ffffff',
  Black:  '#1a1a1a',
  Gray:   '#6b7280',
  Navy:   '#1e3a5f',
  Olive:  '#6b7c45',
  Pink:   '#f9a8d4',
  Blue:   '#3b82f6',
  Coral:  '#f97316',
};

/* ====================================================
   DOM REFERENCES
   ==================================================== */
const $ = id => document.getElementById(id);
const dom = {
  // Navbar
  themeToggle:     $('theme-toggle'),
  cartBtn:         $('cart-btn'),
  cartCount:       $('cart-count'),
  // Cart
  cartOverlay:     $('cart-overlay'),
  cartPanel:       $('cart-panel'),
  cartClose:       $('cart-close'),
  cartItems:       $('cart-items'),
  cartSubtotal:    $('cart-subtotal'),
  cartTotal:       $('cart-total'),
  cartCheckout:    $('cart-checkout'),
  // Checkout modal
  checkoutOverlay: $('checkout-overlay'),
  checkoutClose:   $('checkout-close'),
  checkoutItems:   $('checkout-items'),
  checkoutSubtotal:$('checkout-subtotal'),
  checkoutShipping:$('checkout-shipping'),
  checkoutTotal:   $('checkout-total'),
  checkoutStripe:  $('checkout-stripe'),
  // Install banner
  installBanner:   $('install-banner'),
  installBtn:      $('install-btn'),
  installDismiss:  $('install-dismiss'),
  // Toast
  toastContainer:  $('toast-container'),
  // Hype banner
  hypeTrack:       $('hype-track'),
  // Design Lab
  designLabNavBtn: $('design-lab-nav-btn'),
  dlOverlay:       $('design-lab-overlay'),
  dlClose:         $('dl-close'),
  dlName:          $('dl-name'),
  dlPrice:         $('dl-price'),
  dlDesc:          $('dl-desc'),
  dlMainImg:       $('dl-main-img'),
  dlZoomWrap:      $('dl-zoom-wrap'),
  dlZoomHint:      $('dl-zoom-hint'),
  dlBtnFront:      $('dl-btn-front'),
  dlBtnBack:       $('dl-btn-back'),
  dlFlipRow:       $('dl-flip-row'),
  dlColorOptions:  $('dl-color-options'),
  dlSizeOptions:   $('dl-size-options'),
  dlStock:         $('dl-stock'),
  dlAddToCart:     $('dl-add-to-cart'),
  dlBackToStore:   $('dl-back-to-store'),
};

/* ====================================================
   INIT
   ==================================================== */
async function init() {
  applyTheme(state.theme);
  await loadProducts();
  bindEvents();
  registerServiceWorker();
  handleInstallPrompt();
  checkCheckoutReturn();
  loadCartFromStorage();
  renderCart();
  updateCartCount();
  initHypeBanner();
}

/* ====================================================
   LOAD PRODUCTS (no grid render — data used by Design Lab)
   ==================================================== */
async function loadProducts() {
  try {
    const res = await fetch('./products.json');
    if (!res.ok) throw new Error('Failed to load products');
    state.products = await res.json();
  } catch (err) {
    console.warn('[PrintPath] products.json not loaded:', err.message);
    state.products = [];
  }
}

/* ====================================================
   CART
   ==================================================== */
function quickAddToCart(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  if (typeof ppSound !== 'undefined') ppSound.play('thud');
  addToCart(product, product.sizes[0], product.colors[0], 1);
}

function addToCart(product, size, color, qty) {
  const key = `${product.id}-${size}-${color}`;
  const existing = state.cart.find(i => i.key === key);

  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.push({
      key,
      id:    product.id,
      name:  product.name,
      price: product.price,
      image: product.images[0],
      size,
      color,
      qty,
    });
  }

  saveCartToStorage();
  renderCart();
  updateCartCount(true); // animate
  openCart();
  showToast(`✅ ${product.name} added to cart`, 'success');
  if (typeof ppSound !== 'undefined') ppSound.play('thud');
}

function removeFromCart(key) {
  state.cart = state.cart.filter(i => i.key !== key);
  saveCartToStorage();
  renderCart();
  updateCartCount();
}

function changeCartItemQty(key, delta) {
  const item = state.cart.find(i => i.key === key);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  if (item.qty === 0) {
    removeFromCart(key);
    return;
  }
  saveCartToStorage();
  renderCart();
  updateCartCount();
}

/* ---- Render cart panel ---- */
function renderCart() {
  if (state.cart.length === 0) {
    dom.cartItems.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <strong>Your cart is empty</strong>
        <p>Add some shirts to get started!</p>
      </div>`;
    dom.cartSubtotal.textContent = '$0.00';
    dom.cartTotal.textContent    = '$0.00';
    return;
  }

  dom.cartItems.innerHTML = state.cart.map(item => {
    const colorHex  = COLOR_MAP[item.color] || '#ccc';
    const colorChip = item.color
      ? `<span class="cart-item-swatch"><span class="cart-item-swatch-dot" style="background:${colorHex}"></span>${item.color}</span>`
      : '';
    const sizeChip  = item.size
      ? `<span class="cart-item-size-chip">${item.size}</span>`
      : '';

    // Custom sticker: round image + badge
    const isSticker = !!item.custom_sticker;
    const stickerBadge = isSticker
      ? `<span class="cart-sticker-badge">🎨 Custom Sticker</span>`
      : '';

    return `
    <div class="cart-item" data-key="${item.key}">
      <div class="cart-item-img${isSticker ? ' sticker' : ''}">
        <img src="${item.image}" alt="${item.name}" loading="lazy" />
      </div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}${stickerBadge}</div>
        <div class="cart-item-meta">${sizeChip}${colorChip}</div>
        <div class="cart-item-qty-row">
          <button class="cart-qty-btn" onclick="changeCartItemQty('${item.key}', -1)" aria-label="Decrease quantity">\u2212</button>
          <span class="cart-qty-num">${item.qty}</span>
          <button class="cart-qty-btn" onclick="changeCartItemQty('${item.key}', 1)" aria-label="Increase quantity">+</button>
          <span class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</span>
        </div>
      </div>
      <button class="cart-item-remove" onclick="removeFromCart('${item.key}')" aria-label="Remove ${item.name}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
  }).join('');

  const subtotal = cartSubtotal();
  dom.cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
  dom.cartTotal.textContent    = `$${subtotal.toFixed(2)}`;
}

function cartSubtotal() {
  return state.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function cartItemCount() {
  return state.cart.reduce((sum, i) => sum + i.qty, 0);
}

/* ---- Cart count badge ---- */
function updateCartCount(animate = false) {
  const count = cartItemCount();
  dom.cartCount.textContent = count;
  if (count > 0) {
    dom.cartCount.classList.add('visible');
    if (animate) {
      dom.cartCount.classList.remove('bounce');
      void dom.cartCount.offsetWidth;
      dom.cartCount.classList.add('bounce');
    }
  } else {
    dom.cartCount.classList.remove('visible');
  }
}

/* ---- Open / close cart ---- */
function openCart() {
  dom.cartOverlay.classList.add('open');
  dom.cartPanel.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  dom.cartOverlay.classList.remove('open');
  dom.cartPanel.classList.remove('open');
  document.body.style.overflow = '';
}

/* ---- Persist cart ---- */
function saveCartToStorage() {
  try { localStorage.setItem('td-cart', JSON.stringify(state.cart)); } catch(e) {}
}

function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem('td-cart');
    if (saved) state.cart = JSON.parse(saved);
  } catch(e) { state.cart = []; }
}

/* ====================================================
   CHECKOUT (Stripe)
   ==================================================== */
function openCheckout() {
  if (state.cart.length === 0) return;
  closeCart();

  // If any item is a custom sticker, use the handoff system
  const stickerItems = state.cart.filter(i => i.custom_sticker);
  if (stickerItems.length > 0) {
    const regularItems = state.cart.filter(i => !i.custom_sticker);
    if (regularItems.length === 0) {
      // Whole cart is stickers — build order and execute handoff
      const si = stickerItems[0];
      const order = buildPrintOrder({
        orderType:       'custom_sticker',
        designId:        si.key || ('sticker-' + Date.now()),
        previewImage:    si.image,
        printReadyImage: si.exportUrl || si.image,
        widthInches:     si.printW  || 3,
        heightInches:    si.printH  || 3,
        dpi:             si.dpi    || 300,
        quantity:        si.qty,
        finish:          si.finish  || 'matte',
        cutType:         si.cutType || 'die_cut',
      });
      const result = executeHandoff(order);
      if (result.valid) {
        showToast('Redirecting to print partner…', 'info');
      } else {
        showToast('\u26A0\uFE0F ' + result.errors[0], 'warning');
      }
      return;
    }
    // Mixed cart — warn user
    showToast(
      '⚠️ Your cart has custom stickers. They will be ordered separately via our print partner.',
      'warning'
    );
  }

  // Populate checkout modal
  const subtotal = cartSubtotal();
  const shipping = subtotal > 50 ? 0 : 5.99;
  const total    = subtotal + shipping;

  dom.checkoutItems.innerHTML = state.cart.map(i =>
    `<div class="checkout-summary-row">
      <span>${i.name} × ${i.qty}</span>
      <span>$${(i.price * i.qty).toFixed(2)}</span>
    </div>`).join('');

  dom.checkoutSubtotal.textContent = `$${subtotal.toFixed(2)}`;
  dom.checkoutShipping.textContent = shipping === 0 ? 'FREE' : `$${shipping.toFixed(2)}`;
  dom.checkoutTotal.textContent    = `$${total.toFixed(2)}`;

  dom.checkoutOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCheckout() {
  dom.checkoutOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* ---- Redirect to Stripe Checkout ---- */
async function redirectToStripe() {
  if (STRIPE_CONFIG.publishableKey.includes('YOUR_STRIPE')) {
    showToast('⚠️ Add your Stripe key in app.js to enable checkout', 'warning');
    // Simulate success for demo purposes
    setTimeout(() => {
      simulateCheckoutSuccess();
    }, 1500);
    return;
  }

  try {
    dom.checkoutStripe.textContent = 'Redirecting…';
    dom.checkoutStripe.disabled = true;

    // In production: call your backend to create a Stripe Checkout Session
    // const res = await fetch('/api/create-checkout-session', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ items: state.cart })
    // });
    // const { sessionId } = await res.json();
    // const stripe = Stripe(STRIPE_CONFIG.publishableKey);
    // await stripe.redirectToCheckout({ sessionId });

    showToast('Stripe integration ready — add your backend!', 'success');
    dom.checkoutStripe.textContent = 'Pay with Stripe';
    dom.checkoutStripe.disabled = false;
  } catch (err) {
    console.error('[PrintPath] Stripe error:', err);
    showToast('❌ Checkout failed. Please try again.', 'error');
    dom.checkoutStripe.textContent = 'Pay with Stripe';
    dom.checkoutStripe.disabled = false;
  }
}

function simulateCheckoutSuccess() {
  closeCheckout();
  state.cart = [];
  saveCartToStorage();
  renderCart();
  updateCartCount();
  showToast('🎉 Order sent to print! (Demo mode)', 'success');
}

/* ---- Handle return from Stripe ---- */
function checkCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') === 'success') {
    state.cart = [];
    saveCartToStorage();
    showToast('🎉 Order confirmed! Thanks for shopping with us.', 'success');
    history.replaceState({}, '', window.location.pathname);
  } else if (params.get('checkout') === 'cancel') {
    showToast('Order cancelled. Your cart is saved.', 'info');
    history.replaceState({}, '', window.location.pathname);
  }
}

/* ====================================================
   THEME TOGGLE
   ==================================================== */
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('td-theme', theme);

  // Update toggle icon
  const sunIcon  = dom.themeToggle.querySelector('.icon-sun');
  const moonIcon = dom.themeToggle.querySelector('.icon-moon');
  if (sunIcon && moonIcon) {
    sunIcon.style.display  = theme === 'dark' ? 'block' : 'none';
    moonIcon.style.display = theme === 'dark' ? 'none'  : 'block';
  }
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

/* ====================================================
   TOAST NOTIFICATIONS
   ==================================================== */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : type === 'warning' ? '⚠' : 'ℹ'}</span> ${message}`;
  dom.toastContainer.appendChild(toast);

  // Auto remove after 3s
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ====================================================
   SERVICE WORKER REGISTRATION
   ==================================================== */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[PrintPath] SW registered:', reg.scope))
        .catch(err => console.error('[PrintPath] SW registration failed:', err));
    });
  }
}

/* ====================================================
   PWA INSTALL PROMPT
   ==================================================== */
function handleInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    // Show install banner after 5s
    setTimeout(() => {
      if (!localStorage.getItem('td-install-dismissed')) {
        dom.installBanner.classList.add('visible');
      }
    }, 5000);
  });

  window.addEventListener('appinstalled', () => {
    dom.installBanner.classList.remove('visible');
    showToast('🎉 App installed successfully!', 'success');
    state.deferredInstallPrompt = null;
  });
}

async function triggerInstall() {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  const { outcome } = await state.deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    console.log('[PrintPath] User accepted install');
  }
  state.deferredInstallPrompt = null;
  dom.installBanner.classList.remove('visible');
  ppHideInstallCard();
}

function dismissInstallBanner() {
  dom.installBanner.classList.remove('visible');
  ppHideInstallCard();
  localStorage.setItem('td-install-dismissed', '1');
}

/* ====================================================
   DESIGN LAB
   ==================================================== */
function openDesignLab(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;

  state.dlProduct       = product;
  state.dlSelectedSize  = null;
  state.dlSelectedColor = null;
  state.dlView          = 'front';
  state.dlZoomed        = false;

  dom.dlName.textContent  = product.name;
  dom.dlPrice.textContent = `$${product.price.toFixed(2)}`;
  dom.dlDesc.textContent  = product.description;

  const frontImg = product.imageFront || product.images[0];
  dom.dlMainImg.src = frontImg;
  dom.dlMainImg.alt = product.name + ' — front view';
  dom.dlZoomWrap.classList.remove('zoomed');
  dom.dlMainImg.style.opacity   = '0';
  dom.dlMainImg.style.transform = 'scale(0.97)';
  dom.dlMainImg.style.transition = 'none';

  const hasBack = !!(product.imageBack || product.images[1]);
  if (dom.dlFlipRow) dom.dlFlipRow.style.display = hasBack ? 'flex' : 'none';
  dom.dlBtnFront.classList.add('active');
  dom.dlBtnBack.classList.remove('active');

  dlRenderStock(product.stock);

  dom.dlColorOptions.innerHTML = product.colors.map(c => `
    <button class="color-btn" data-color="${c}"
      style="background:${COLOR_MAP[c] || '#ccc'}; border-color:${COLOR_MAP[c] || '#ccc'}"
      aria-label="Select color ${c}" title="${c}"
      onclick="dlSelectColor(this, '${c}')"></button>`).join('');

  dom.dlSizeOptions.innerHTML = product.sizes.map(s => `
    <button class="size-btn" data-size="${s}" aria-label="Select size ${s}"
      onclick="dlSelectSize(this, '${s}')">${s}</button>`).join('');

  // Open with native-feel animation
  if (typeof PP !== 'undefined') {
    const modal = dom.dlOverlay.querySelector('.dl-modal');
    PP.openOverlay(dom.dlOverlay, modal, 'bottom');
  } else {
    dom.dlOverlay.style.display = 'flex';
  }
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => {
    setTimeout(() => {
      dom.dlMainImg.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      dom.dlMainImg.style.opacity   = '1';
      dom.dlMainImg.style.transform = 'scale(1)';
    }, 50);
  });

  history.pushState({ page: 'designlab', id }, '', `#lab-${id}`);
}

function closeDesignLab() {
  if (typeof PP !== 'undefined') {
    const modal = dom.dlOverlay.querySelector('.dl-modal');
    PP.closeOverlay(dom.dlOverlay, modal, () => {
      document.body.style.overflow = '';
    });
  } else {
    dom.dlOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }
  state.dlZoomed = false;
  dom.dlZoomWrap.classList.remove('zoomed');
}

function dlSetView(view) {
  const product = state.dlProduct;
  if (!product) return;
  state.dlView = view;

  const img = view === 'front'
    ? (product.imageFront || product.images[0])
    : (product.imageBack  || product.images[1] || product.images[0]);

  dom.dlMainImg.style.opacity   = '0';
  dom.dlMainImg.style.transform = 'scale(0.96)';
  setTimeout(() => {
    dom.dlMainImg.src = img;
    dom.dlMainImg.alt = `${product.name} — ${view} view`;
    dom.dlMainImg.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    dom.dlMainImg.style.opacity   = '1';
    dom.dlMainImg.style.transform = 'scale(1)';
  }, 140);

  state.dlZoomed = false;
  dom.dlZoomWrap.classList.remove('zoomed');
  dom.dlBtnFront.classList.toggle('active', view === 'front');
  dom.dlBtnBack.classList.toggle('active',  view === 'back');
}

function dlSelectColor(btn, color) {
  state.dlSelectedColor = color;
  dom.dlColorOptions.querySelectorAll('.color-btn').forEach(b =>
    b.classList.toggle('selected', b === btn));
}

function dlSelectSize(btn, size) {
  state.dlSelectedSize = size;
  dom.dlSizeOptions.querySelectorAll('.size-btn').forEach(b =>
    b.classList.toggle('selected', b === btn));
}

function dlRenderStock(stock) {
  if (stock === undefined || stock === null) {
    dom.dlStock.textContent = '';
    return;
  }
  if (stock === 0) {
    dom.dlStock.className   = 'dl-stock critical';
    dom.dlStock.textContent = '✕ Out of stock';
  } else if (stock <= 5) {
    dom.dlStock.className   = 'dl-stock critical';
    dom.dlStock.textContent = `🔥 Only ${stock} left — grab it!`;
  } else if (stock <= 15) {
    dom.dlStock.className   = 'dl-stock low';
    dom.dlStock.textContent = `⚡ Low stock — ${stock} remaining`;
  } else {
    dom.dlStock.className   = 'dl-stock plenty';
    dom.dlStock.textContent = '✓ In stock';
  }
}

function dlToggleZoom(e) {
  state.dlZoomed = !state.dlZoomed;
  dom.dlZoomWrap.classList.toggle('zoomed', state.dlZoomed);
  if (state.dlZoomed) {
    const rect = dom.dlZoomWrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1) + '%';
    const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1) + '%';
    dom.dlZoomWrap.style.setProperty('--zoom-x', x);
    dom.dlZoomWrap.style.setProperty('--zoom-y', y);
  }
}

function dlAddToCartFromLab() {
  const product = state.dlProduct;
  if (!product) return;
  if (!state.dlSelectedSize) {
    showToast('⚠️ Please select a size', 'warning');
    return;
  }
  addToCart(product, state.dlSelectedSize, state.dlSelectedColor, 1);
  closeDesignLab();
}

/* ====================================================
   HYPE BANNER
   ==================================================== */
function initHypeBanner() {
  if (!dom.hypeTrack) return;
  // Duplicate for seamless loop
  const items = [...HYPE_MESSAGES, ...HYPE_MESSAGES];
  dom.hypeTrack.innerHTML = items.map(m =>
    `<span class="hype-item">${m.icon} ${m.text}<span class="hype-sep"> · </span></span>`
  ).join('');
}

/* ====================================================
   BROWSER BACK BUTTON
   ==================================================== */
window.addEventListener('popstate', e => {
  // Close AI Gen if open
  if (typeof aiGenState !== 'undefined' && aiGenState.open) {
    if (typeof PP !== 'undefined') {
      const overlay = document.getElementById('ai-gen-overlay');
      const modal = overlay ? overlay.querySelector('.ai-gen-modal') : null;
      PP.closeOverlay(overlay, modal, () => {
        aiGenState.open = false;
        document.body.style.overflow = '';
      });
    } else {
      closeAiGen();
    }
    return;
  }
  // Close Sticker Lab if open
  if (typeof stickerState !== 'undefined' && stickerState.open) {
    if (typeof PP !== 'undefined') {
      const overlay = document.querySelector('.sl-overlay');
      const modal = overlay ? overlay.querySelector('.sl-modal') : null;
      PP.closeOverlay(overlay, modal, () => {
        stickerState.open = false;
        document.body.style.overflow = '';
      });
    } else {
      closeStickerLab();
    }
    return;
  }
  // Close Design Lab if open
  if (dom.dlOverlay && dom.dlOverlay.style.display === 'flex') {
    if (typeof PP !== 'undefined') {
      const modal = dom.dlOverlay.querySelector('.dl-modal');
      PP.closeOverlay(dom.dlOverlay, modal, () => {
        document.body.style.overflow = '';
      });
    } else {
      dom.dlOverlay.style.display = 'none';
      document.body.style.overflow = '';
    }
    return;
  }
});

/* ====================================================
   BIND EVENTS
   ==================================================== */
function bindEvents() {
  // Theme toggle
  dom.themeToggle.addEventListener('click', toggleTheme);

  // Cart open/close
  dom.cartBtn.addEventListener('click', openCart);
  dom.cartClose.addEventListener('click', closeCart);
  dom.cartOverlay.addEventListener('click', e => {
    if (e.target === dom.cartOverlay) closeCart();
  });

  // Checkout
  dom.cartCheckout.addEventListener('click', openCheckout);
  dom.checkoutClose.addEventListener('click', closeCheckout);
  dom.checkoutOverlay.addEventListener('click', e => {
    if (e.target === dom.checkoutOverlay) closeCheckout();
  });
  dom.checkoutStripe.addEventListener('click', redirectToStripe);

  // PWA install
  dom.installBtn.addEventListener('click', triggerInstall);
  dom.installDismiss.addEventListener('click', dismissInstallBanner);

  // Premium install card buttons
  const cardBtn     = document.getElementById('pp-install-card-btn');
  const cardDismiss = document.getElementById('pp-install-card-dismiss');
  if (cardBtn)     cardBtn.addEventListener('click', triggerInstall);
  if (cardDismiss) cardDismiss.addEventListener('click', dismissInstallBanner);

  // Keyboard: close panels on Escape (Sticker Lab → Design Lab → checkout → cart)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (typeof stickerState !== 'undefined' && stickerState.open) closeStickerLab();
      else if (dom.dlOverlay && dom.dlOverlay.style.display === 'flex') closeDesignLab();
      else if (dom.checkoutOverlay.classList.contains('open')) closeCheckout();
      else if (dom.cartPanel.classList.contains('open')) closeCart();
    }
  });

  // Design Lab — open from navbar button (opens lab directly)
  if (dom.designLabNavBtn) {
    dom.designLabNavBtn.addEventListener('click', () => {
      openDesignLab(1);
    });
  }

  // Design Lab — close / backdrop / cart / back buttons
  if (dom.dlClose)      dom.dlClose.addEventListener('click', closeDesignLab);
  if (dom.dlBackToStore) dom.dlBackToStore.addEventListener('click', closeDesignLab);
  if (dom.dlOverlay)    dom.dlOverlay.addEventListener('click', e => {
    if (e.target === dom.dlOverlay) closeDesignLab();
  });
  if (dom.dlAddToCart)  dom.dlAddToCart.addEventListener('click', dlAddToCartFromLab);
  if (dom.dlZoomWrap)   dom.dlZoomWrap.addEventListener('click', dlToggleZoom);
}

/* ====================================================
   START THE APP
   ==================================================== */
document.addEventListener('DOMContentLoaded', init);

// Scroll-reveal for homepage sections
(function () {
  const targets = document.querySelectorAll(
    '.how-section, .diff-section, .category-section, .lab-entry-section, .proof-section, .final-cta-section'
  );
  if (!targets.length || !('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  targets.forEach(el => io.observe(el));
})();
