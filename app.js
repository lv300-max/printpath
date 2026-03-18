/* ============================================================
   PrintPath — Main Application Script
   Vanilla JS SPA: product grid, product detail, cart, checkout
   ============================================================ */

'use strict';

/* ====================================================
   STATE
   ==================================================== */
const state = {
  products: [],
  filteredProducts: [],
  cart: [],
  currentProduct: null,
  selectedSize: null,
  selectedColor: null,
  selectedQty: 1,
  currentGalleryIndex: 0,
  activeColorFilter: 'all',
  activeSizeFilter: 'all',
  activeBadgeFilter: 'all',
  activeFeaturedFilter: false,
  searchQuery: '',
  theme: localStorage.getItem('td-theme') || 'light',
  deferredInstallPrompt: null,
  // Design Lab
  dlProduct: null,
  dlSelectedSize: null,
  dlSelectedColor: null,
  dlView: 'front',
  dlZoomed: false,
  countdownInterval: null,
};

/* ====================================================
   HYPE BANNER MESSAGES — edit to customize ticker
   ==================================================== */
const HYPE_MESSAGES = [
  { icon: '⚡', text: 'AI-powered designs — print-ready in seconds' },
  { icon: '🎯', text: '300 DPI guaranteed on every design' },
  { icon: '🚚', text: 'Free shipping on orders over $75' },
  { icon: '🔥', text: 'New drops every Friday — don\'t sleep on it' },
  { icon: '↩️', text: '30-day hassle-free returns' },
  { icon: '⬡', text: 'PrintPath: Design it. We make it print-perfect.' },
  { icon: '🔒', text: 'Secure checkout powered by Stripe' },
];

/* ====================================================
   FEATURED DROP CONFIG
   Set dropDate to a future ISO date string.
   Set productId to a product with featuredDrop:true.
   ==================================================== */
const FEATURED_DROP = {
  productId: 7,
  dropDate: '2026-03-28T20:00:00',
};

/* ====================================================
   BADGE LABELS — human-readable display text
   ==================================================== */
const BADGE_LABELS = {
  new:        'New Drop',
  bestseller: 'Best Seller',
  limited:    'Limited',
  sale:       'Sale',
  lowstock:   'Low Stock',
};

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
  // Pages
  pageShop:        $('page-shop'),
  pageProduct:     $('page-product'),
  // Navbar
  themeToggle:     $('theme-toggle'),
  cartBtn:         $('cart-btn'),
  cartCount:       $('cart-count'),
  // Filters
  searchInput:     $('search-input'),
  sizeFilter:      $('size-filter'),
  colorFilter:     $('color-filter'),
  resultsInfo:     $('results-info'),
  sizePills:       $('size-pills'),
  colorPills:      $('color-pills'),
  // Product grid
  productGrid:     $('product-grid'),
  // Product detail
  pdBack:          $('pd-back'),
  pdGalleryMain:   $('pd-gallery-main'),
  pdGalleryThumbs: $('pd-gallery-thumbs'),
  pdBadge:         $('pd-badge'),
  pdName:          $('pd-name'),
  pdPrice:         $('pd-price'),
  pdDesc:          $('pd-desc'),
  pdSizeOptions:   $('pd-size-options'),
  pdColorOptions:  $('pd-color-options'),
  pdQtyDec:        $('pd-qty-dec'),
  pdQtyInc:        $('pd-qty-inc'),
  pdQtyVal:        $('pd-qty-val'),
  pdAddToCart:     $('pd-add-to-cart'),
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
  // Filter additions
  badgePills:      $('badge-pills'),
  featuredToggle:  $('featured-toggle'),
  // Hype banner
  hypeTrack:       $('hype-track'),
  // Countdown
  countdownSection:$('countdown-section'),
  cdDays:          $('cd-days'),
  cdHours:         $('cd-hours'),
  cdMins:          $('cd-mins'),
  cdSecs:          $('cd-secs'),
  cdProductName:   $('countdown-product-name'),
  cdProductDesc:   $('countdown-product-desc'),
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
  initCountdown();
}

/* ====================================================
   LOAD PRODUCTS
   ==================================================== */
async function loadProducts() {
  // Show skeletons while loading
  renderSkeletons();

  try {
    const res = await fetch('./products.json');
    if (!res.ok) throw new Error('Failed to load products');
    state.products = await res.json();
    state.filteredProducts = [...state.products];
    buildFilterOptions();
    renderProductGrid();
  } catch (err) {
    console.error('[PrintPath] Error loading products:', err);
    dom.productGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">😢</div>
        <h3>Couldn't load products</h3>
        <p>Please check your connection and try again.</p>
      </div>`;
  }
}

/* ---- Skeleton placeholders ---- */
function renderSkeletons() {
  dom.productGrid.innerHTML = Array(8).fill(0).map(() => `
    <div class="skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div class="skeleton-body">
        <div class="skeleton skeleton-text-lg"></div>
        <div class="skeleton skeleton-text-sm"></div>
        <div class="skeleton skeleton-price"></div>
      </div>
    </div>`).join('');
}

/* ====================================================
   BUILD FILTER OPTIONS
   ==================================================== */
function buildFilterOptions() {
  const allSizes  = [...new Set(state.products.flatMap(p => p.sizes))];
  const allColors = [...new Set(state.products.flatMap(p => p.colors))];
  const allBadges = [...new Set(state.products.map(p => p.badge).filter(Boolean))];

  // Size pills
  dom.sizePills.innerHTML = ['all', ...allSizes].map(s => `
    <button class="pill${s === 'all' ? ' active' : ''}" data-size="${s}" aria-label="Filter by size ${s}">
      ${s === 'all' ? 'All Sizes' : s}
    </button>`).join('');

  // Color pills
  dom.colorPills.innerHTML = ['all', ...allColors].map(c => `
    <button class="pill${c === 'all' ? ' active' : ''}" data-color="${c}" aria-label="Filter by color ${c}">
      ${c === 'all' ? 'All Colors' : c}
    </button>`).join('');

  // Badge pills
  dom.badgePills.innerHTML = allBadges.map(b => `
    <button class="pill" data-badge="${b}" aria-label="Filter by ${BADGE_LABELS[b] || b}">
      ${BADGE_LABELS[b] || b}
    </button>`).join('');

  // Rebind pill events
  dom.sizePills.querySelectorAll('.pill').forEach(btn =>
    btn.addEventListener('click', () => handleSizePill(btn.dataset.size)));
  dom.colorPills.querySelectorAll('.pill').forEach(btn =>
    btn.addEventListener('click', () => handleColorPill(btn.dataset.color)));
  dom.badgePills.querySelectorAll('.pill').forEach(btn =>
    btn.addEventListener('click', () => handleBadgePill(btn.dataset.badge)));
}

/* ====================================================
   RENDER PRODUCT GRID
   ==================================================== */
function renderProductGrid() {
  const products = state.filteredProducts;

  if (products.length === 0) {
    dom.productGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No shirts found</h3>
        <p>Try adjusting your filters or search query.</p>
        <button class="btn btn-secondary" onclick="clearFilters()" style="margin-top:1rem">Clear Filters</button>
      </div>`;
    dom.resultsInfo.textContent = '0 results';
    return;
  }

  dom.resultsInfo.textContent = `${products.length} shirt${products.length !== 1 ? 's' : ''} found`;

  dom.productGrid.innerHTML = products.map(product => {
    const colorDots = product.colors.map(c =>
      `<span class="color-dot" style="background:${COLOR_MAP[c] || '#ccc'}" title="${c}"></span>`
    ).join('');

    const badgeLabel = BADGE_LABELS[product.badge] || product.badge;
    const badge = product.badge ? `
      <span class="card-badge badge-${product.badge}">${badgeLabel}</span>` : '';

    const labBtn = `
      <button class="card-lab-btn" onclick="event.stopPropagation(); openDesignLab(${product.id})"
        aria-label="Open ${product.name} in Design Lab" title="Design Lab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>`;

    const stockRow = (product.stock > 0 && product.stock <= 10) ? `
      <p class="card-lowstock-row">🔥 Only ${product.stock} left</p>` : '';

    return `
      <article class="product-card" data-id="${product.id}" role="button" tabindex="0"
        aria-label="View ${product.name} — $${product.price.toFixed(2)}"
        onclick="openProductPage(${product.id})"
        onkeydown="if(event.key==='Enter') openProductPage(${product.id})">
        <div class="card-image-wrap">
          ${badge}
          ${labBtn}
          <img
            src="${product.images[0]}"
            alt="${product.name}"
            loading="lazy"
            decoding="async"
            width="400" height="500"
          />
          <button class="card-quick-add" onclick="event.stopPropagation(); quickAddToCart(${product.id})"
            aria-label="Quick add ${product.name} to cart">
            + Quick Add
          </button>
        </div>
        <div class="card-body">
          <h3 class="card-name">${product.name}</h3>
          <div class="card-colors" aria-label="Available colors">${colorDots}</div>
          <p class="card-price">$${product.price.toFixed(2)}</p>
          ${stockRow}
        </div>
      </article>`;
  }).join('');
}

/* ====================================================
   FILTER LOGIC
   ==================================================== */
function applyFilters() {
  const q        = state.searchQuery.toLowerCase();
  const size     = state.activeSizeFilter;
  const color    = state.activeColorFilter;
  const badge    = state.activeBadgeFilter;
  const featured = state.activeFeaturedFilter;

  state.filteredProducts = state.products.filter(p => {
    const matchSearch   = !q || p.name.toLowerCase().includes(q) ||
                          p.description.toLowerCase().includes(q) ||
                          p.colors.some(c => c.toLowerCase().includes(q));
    const matchSize     = size    === 'all' || p.sizes.includes(size);
    const matchColor    = color   === 'all' || p.colors.includes(color);
    const matchBadge    = badge   === 'all' || p.badge === badge;
    const matchFeatured = !featured || p.featuredDrop === true;
    return matchSearch && matchSize && matchColor && matchBadge && matchFeatured;
  });

  renderProductGrid();
}

function handleSizePill(size) {
  state.activeSizeFilter = size;
  dom.sizePills.querySelectorAll('.pill').forEach(b => {
    b.classList.toggle('active', b.dataset.size === size);
  });
  applyFilters();
}

function handleColorPill(color) {
  state.activeColorFilter = color;
  dom.colorPills.querySelectorAll('.pill').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });
  applyFilters();
}

function handleBadgePill(badge) {
  // Clicking the active badge deselects it
  state.activeBadgeFilter = state.activeBadgeFilter === badge ? 'all' : badge;
  dom.badgePills.querySelectorAll('.pill').forEach(b => {
    b.classList.toggle('active', b.dataset.badge === state.activeBadgeFilter);
  });
  applyFilters();
}

function clearFilters() {
  state.searchQuery          = '';
  state.activeSizeFilter     = 'all';
  state.activeColorFilter    = 'all';
  state.activeBadgeFilter    = 'all';
  state.activeFeaturedFilter = false;
  dom.searchInput.value      = '';
  dom.sizePills.querySelectorAll('.pill').forEach(b =>
    b.classList.toggle('active', b.dataset.size === 'all'));
  dom.colorPills.querySelectorAll('.pill').forEach(b =>
    b.classList.toggle('active', b.dataset.color === 'all'));
  dom.badgePills.querySelectorAll('.pill').forEach(b =>
    b.classList.remove('active'));
  dom.featuredToggle.classList.remove('active');
  applyFilters();
}

/* ====================================================
   PRODUCT DETAIL PAGE
   ==================================================== */
function openProductPage(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;

  state.currentProduct = product;
  state.selectedSize   = null;
  state.selectedColor  = null;
  state.selectedQty    = 1;
  state.currentGalleryIndex = 0;

  // Populate fields
  dom.pdName.textContent  = product.name;
  dom.pdPrice.textContent = `$${product.price.toFixed(2)}`;
  dom.pdDesc.textContent  = product.description;

  // Badge
  dom.pdBadge.innerHTML = product.badge
    ? `<span class="card-badge badge-${product.badge}">${product.badge}</span>`
    : '';

  // Gallery
  renderGallery(product);

  // Sizes
  dom.pdSizeOptions.innerHTML = product.sizes.map(s => `
    <button class="size-btn" data-size="${s}" aria-label="Select size ${s}"
      onclick="selectSize(this, '${s}')">${s}</button>`).join('');

  // Colors
  dom.pdColorOptions.innerHTML = product.colors.map(c => `
    <button class="color-btn" data-color="${c}"
      style="background:${COLOR_MAP[c] || '#ccc'}; border-color:${COLOR_MAP[c] || '#ccc'}"
      aria-label="Select color ${c}" title="${c}"
      onclick="selectColor(this, '${c}')"></button>`).join('');

  // Quantity
  dom.pdQtyVal.textContent = 1;

  // Switch views with native-feel slide transition
  if (typeof PP !== 'undefined' && !PP.prefersReducedMotion()) {
    PP.transitionToProduct(dom.pageShop, dom.pageProduct);
  } else {
    dom.pageShop.style.display = 'none';
    dom.pageProduct.style.display = 'block';
    window.scrollTo({ top: 0 });
  }

  // Update browser history
  history.pushState({ page: 'product', id }, '', `#product-${id}`);
}

function closeProductPage() {
  if (typeof PP !== 'undefined' && !PP.prefersReducedMotion()) {
    PP.transitionToShop(dom.pageProduct, dom.pageShop);
  } else {
    dom.pageProduct.style.display = 'none';
    dom.pageShop.style.display = 'block';
    window.scrollTo({ top: 0 });
  }

  history.pushState({ page: 'shop' }, '', window.location.pathname);
}

/* ---- Gallery ---- */
function renderGallery(product) {
  const mainImg = dom.pdGalleryMain.querySelector('img');
  mainImg.src = product.images[0];
  mainImg.alt = product.name;

  dom.pdGalleryThumbs.innerHTML = product.images.map((img, i) => `
    <div class="gallery-thumb ${i === 0 ? 'active' : ''}" data-index="${i}"
      onclick="switchGalleryImage(${i})" role="button" tabindex="0"
      aria-label="View image ${i + 1}">
      <img src="${img}" alt="${product.name} view ${i + 1}" loading="lazy" decoding="async" />
    </div>`).join('');
}

function switchGalleryImage(index) {
  const product = state.currentProduct;
  const mainImg = dom.pdGalleryMain.querySelector('img');
  mainImg.style.opacity = '0';
  mainImg.style.transform = 'scale(0.96)';
  setTimeout(() => {
    mainImg.src = product.images[index];
    mainImg.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    mainImg.style.opacity = '1';
    mainImg.style.transform = 'scale(1)';
  }, 150);

  dom.pdGalleryThumbs.querySelectorAll('.gallery-thumb').forEach((t, i) =>
    t.classList.toggle('active', i === index));
  state.currentGalleryIndex = index;
}

/* ---- Size / Color selectors ---- */
function selectSize(btn, size) {
  state.selectedSize = size;
  dom.pdSizeOptions.querySelectorAll('.size-btn').forEach(b =>
    b.classList.toggle('selected', b === btn));
}

function selectColor(btn, color) {
  state.selectedColor = color;
  dom.pdColorOptions.querySelectorAll('.color-btn').forEach(b =>
    b.classList.toggle('selected', b === btn));
}

/* ---- Quantity ---- */
function changeQty(delta) {
  state.selectedQty = Math.max(1, Math.min(99, state.selectedQty + delta));
  dom.pdQtyVal.textContent = state.selectedQty;
}

/* ====================================================
   CATEGORY FILTER (homepage category section)
   ==================================================== */
function filterByCategory(category) {
  // Scroll to the product grid and apply a search filter
  if (dom.searchInput) {
    dom.searchInput.value = category;
    state.searchQuery = category;
    applyFilters();
  }
  const grid = document.getElementById('product-grid');
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ====================================================
   CART
   ==================================================== */
function quickAddToCart(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  if (typeof ppSound !== 'undefined') ppSound.play('thud');
  // Use first available size/color as default for quick add
  addToCart(product, product.sizes[0], product.colors[0], 1);
}

function addToCartFromDetail() {
  const product = state.currentProduct;
  if (!product) return;

  if (!state.selectedSize) {
    showToast('⚠️ Please select a size', 'warning');
    // Shake size buttons
    dom.pdSizeOptions.style.animation = 'none';
    dom.pdSizeOptions.offsetHeight; // reflow
    dom.pdSizeOptions.style.animation = 'countBounce 0.4s ease';
    return;
  }

  addToCart(product, state.selectedSize, state.selectedColor, state.selectedQty);
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

  // Animate the add-to-cart button
  if (dom.pdAddToCart) {
    dom.pdAddToCart.classList.remove('btn-bounce');
    void dom.pdAddToCart.offsetWidth; // reflow
    dom.pdAddToCart.classList.add('btn-bounce');
  }
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
}

function dismissInstallBanner() {
  dom.installBanner.classList.remove('visible');
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
   FEATURED DROP COUNTDOWN
   ==================================================== */
function initCountdown() {
  const product = state.products.find(p => p.id === FEATURED_DROP.productId && p.featuredDrop);
  if (!product || !FEATURED_DROP.dropDate) return;

  const target = new Date(FEATURED_DROP.dropDate).getTime();
  if (isNaN(target)) return;

  if (dom.cdProductName) dom.cdProductName.textContent = product.name;

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) {
      if (dom.cdProductDesc) dom.cdProductDesc.textContent = '🔥 Drop is live now!';
      ['cdDays','cdHours','cdMins','cdSecs'].forEach(k => { if (dom[k]) dom[k].textContent = '00'; });
      clearInterval(state.countdownInterval);
      return;
    }
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000)  / 60000);
    const secs  = Math.floor((diff % 60000)    / 1000);
    if (dom.cdDays)  dom.cdDays.textContent  = String(days).padStart(2, '0');
    if (dom.cdHours) dom.cdHours.textContent = String(hours).padStart(2, '0');
    if (dom.cdMins)  dom.cdMins.textContent  = String(mins).padStart(2, '0');
    if (dom.cdSecs)  dom.cdSecs.textContent  = String(secs).padStart(2, '0');
  }

  if (dom.countdownSection) dom.countdownSection.style.display = 'block';
  tick();
  state.countdownInterval = setInterval(tick, 1000);
}

/* Scroll to featured drop products */
function scrollToFeatured() {
  state.activeFeaturedFilter = true;
  if (dom.featuredToggle) dom.featuredToggle.classList.add('active');
  applyFilters();
  closeDesignLab();
  setTimeout(() => {
    if (dom.productGrid) dom.productGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
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
  if (dom.pageProduct.style.display === 'block') {
    if (typeof PP !== 'undefined' && !PP.prefersReducedMotion()) {
      PP.transitionToShop(dom.pageProduct, dom.pageShop);
    } else {
      dom.pageProduct.style.display = 'none';
      dom.pageShop.style.display   = 'block';
    }
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

  // Product page back
  dom.pdBack.addEventListener('click', closeProductPage);

  // Product page add to cart
  dom.pdAddToCart.addEventListener('click', addToCartFromDetail);

  // Quantity controls
  dom.pdQtyDec.addEventListener('click', () => changeQty(-1));
  dom.pdQtyInc.addEventListener('click', () => changeQty(+1));

  // Search (debounced)
  let searchDebounce;
  dom.searchInput.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      applyFilters();
    }, 280);
  });

  // Clear search on Escape
  dom.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      dom.searchInput.value = '';
      state.searchQuery = '';
      applyFilters();
    }
  });

  // PWA install
  dom.installBtn.addEventListener('click', triggerInstall);
  dom.installDismiss.addEventListener('click', dismissInstallBanner);

  // Keyboard: close panels on Escape (Sticker Lab → Design Lab → checkout → cart → product)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (typeof stickerState !== 'undefined' && stickerState.open) closeStickerLab();
      else if (dom.dlOverlay && dom.dlOverlay.style.display === 'flex') closeDesignLab();
      else if (dom.checkoutOverlay.classList.contains('open')) closeCheckout();
      else if (dom.cartPanel.classList.contains('open')) closeCart();
      else if (dom.pageProduct.style.display === 'block') closeProductPage();
    }
  });

  // Design Lab — open from navbar button (first featured product or first product)
  if (dom.designLabNavBtn) {
    dom.designLabNavBtn.addEventListener('click', () => {
      const featured = state.products.find(p => p.featuredDrop) || state.products[0];
      if (featured) openDesignLab(featured.id);
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

  // Featured drop toggle
  if (dom.featuredToggle) {
    dom.featuredToggle.addEventListener('click', () => {
      state.activeFeaturedFilter = !state.activeFeaturedFilter;
      dom.featuredToggle.classList.toggle('active', state.activeFeaturedFilter);
      applyFilters();
    });
  }
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
