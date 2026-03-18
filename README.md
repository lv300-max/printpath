# ThreadDrop — Premium T-Shirt Store

A fully-featured PWA e-commerce storefront built with vanilla JS, HTML5, and CSS3. No frameworks, no build step — just open and run.

---

## 🚀 Quick Start

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

---

## 📦 File Overview

| File | Purpose |
|------|---------|
| `index.html` | Single-page app shell, all sections and modals |
| `styles.css` | All styles — theme, layout, Design Lab, hype banner |
| `app.js` | All logic — state, filters, cart, Design Lab, countdown |
| `products.json` | Product catalog — edit this to add/update products |
| `manifest.json` | PWA manifest (icons, name, theme color) |
| `sw.js` | Service worker — cache-first strategy for offline use |
| `icons/` | PNG app icons (72–512px, auto-generated) |

---

## 🛍️ products.json Field Reference

Each product object supports these fields:

```json
{
  "id": 1,
  "name": "Classic White Tee",
  "price": 34.99,
  "description": "Short product description shown on the card and product page.",
  "images": [
    "https://images.unsplash.com/photo-ID?w=800&q=80"
  ],
  "imageFront": "https://images.unsplash.com/photo-FRONT?w=800&q=80",
  "imageBack":  "https://images.unsplash.com/photo-BACK?w=800&q=80",
  "sizes": ["XS","S","M","L","XL","2XL"],
  "colors": ["White","Black","Gray"],
  "category": "essentials",
  "badge": "bestseller",
  "stock": 42,
  "featuredDrop": false
}
```

### Field Details

#### `images` (required)
Array of image URLs shown in the product detail gallery. At least one URL is required.

#### `imageFront` / `imageBack` (optional)
Dedicated front and back view images used by the **Design Lab**. If omitted:
- `imageFront` falls back to `images[0]`
- `imageBack` falls back to `images[1]` (if it exists), otherwise hides the flip button

Use 800–1200px wide images for best zoom quality.

#### `badge` (optional)
A string label displayed as a colored chip on the product card. Valid values:

| Value | Display Label | Color |
|-------|--------------|-------|
| `"new"` | New Drop | Green |
| `"bestseller"` | Best Seller | Purple |
| `"limited"` | Limited | Orange |
| `"sale"` | Sale | Red |
| `"lowstock"` | Low Stock | Amber |
| `""` | *(no badge)* | — |

Badge pills appear in the filter bar so shoppers can filter by badge type.

#### `stock` (optional)
Integer. Used in two places:
- **Product card** — shows "🔥 Only N left" when `stock ≤ 10`
- **Design Lab** — shows an in-stock/low-stock/out-of-stock indicator

| Stock | Design Lab message |
|-------|--------------------|
| `0` | ✕ Out of stock |
| `1–5` | 🔥 Only N left — grab it! |
| `6–15` | ⚡ Low stock — N remaining |
| `16+` | ✓ In stock |

#### `featuredDrop` (optional)
Boolean. Set to `true` to include this product in the **Featured Drop** countdown section and make it filterable via the "Featured Drop" toggle in the filter bar.

---

## 🧪 Design Lab

The Design Lab is a full-screen product preview modal. Shoppers can:

- **Flip** between front and back views (if `imageBack` is set)
- **Zoom** — click the image to zoom in at the exact spot clicked; click again to zoom out
- **Pick a color** — color swatch buttons (driven by `colors` array)
- **Pick a size** — size chip buttons (driven by `sizes` array)
- **Add to cart** directly from the lab

### Opening the Design Lab

Three ways to open it:
1. **Pencil icon** on any product card (hover to reveal)
2. **"Design Lab" button** in the navbar (opens the first featured product, or the first product if none is featured)
3. Pressing `Escape` closes it

---

## ⏱️ Countdown Timer

The countdown section appears above the product grid when a featured drop is configured.

### Configuration (in `app.js`)

```js
const FEATURED_DROP = {
  productId: 7,                    // must match a product with featuredDrop: true
  dropDate: '2026-03-28T20:00:00', // ISO date string — your drop datetime
};
```

When `Date.now()` passes `dropDate`, the timer changes to "🔥 Drop is live now!"

The countdown section is hidden (`display:none`) by default and only shown if a valid `FEATURED_DROP` configuration is found and the product exists in `products.json`.

---

## 📢 Hype Banner

The scrolling ticker at the top of every page. Edit the messages in `app.js`:

```js
const HYPE_MESSAGES = [
  { icon: '⚡', text: 'Limited drop live now — don\'t sleep on it' },
  { icon: '🚚', text: 'Free shipping on orders over $75' },
  { icon: '🔥', text: 'Street Art Drop: only 5 left in stock' },
  // add/remove entries freely
];
```

Each entry has an `icon` (emoji) and a `text` string. The array is automatically duplicated for a seamless infinite scroll loop.

---

## 🏷️ Badge Filter Pills

Appear in the filter bar automatically based on which badge values exist in `products.json`. Clicking a badge pill filters the grid to only products with that badge. Clicking the same pill again clears the filter.

The "Featured Drop" toggle shows only products where `featuredDrop: true`.

---

## 🛒 Cart

- **Quick Add** button on each card uses the first size and color as defaults
- **Design Lab** add-to-cart requires a size selection (color is optional)
- Cart is persisted to `localStorage` (`td-cart` key)
- Each item shows a **color swatch dot** + **size chip** for clarity

---

## 💳 Stripe Checkout

Replace the placeholder key in `app.js` with your real publishable key:

```js
const STRIPE_CONFIG = {
  publishableKey: 'pk_live_YOUR_KEY_HERE',
  successUrl: `${window.location.origin}/?checkout=success`,
  cancelUrl:  `${window.location.origin}/?checkout=cancel`,
};
```

You'll also need a backend endpoint that creates a Stripe Checkout Session. The commented-out code in `redirectToStripe()` shows the pattern.

---

## 🌗 Dark / Light Mode

The sun/moon button in the navbar toggles between themes. The preference is saved to `localStorage` (`td-theme` key) and restored on next visit.

Custom properties for theming are in `:root` / `[data-theme="dark"]` blocks at the top of `styles.css`.

---

## 📲 PWA / Install

The app registers a service worker (`sw.js`) with a cache-first strategy. Users on mobile or desktop Chrome/Edge will see an install prompt after 5 seconds (if they haven't dismissed it before).

To update the icons, re-run the icon generation script or replace files in `icons/`.

---

## 🗂️ Adding a New Product

1. Open `products.json`
2. Copy an existing product object
3. Change `id` to the next sequential number
4. Fill in `name`, `price`, `description`, `images`, `imageFront`, `imageBack`
5. Set `sizes`, `colors`, `badge`, `stock`, `featuredDrop` as needed
6. Save — the store reloads automatically

No build step required.
