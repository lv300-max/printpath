/* ============================================================
   PrintPath — Native App Feel Engine
   Smooth page transitions, gesture feedback, scroll-aware
   navbar, micro-animations — all vanilla JS, no dependencies
   ============================================================ */
'use strict';

const PP = (() => {

  /* ---- Spring easing (approximated cubic-bezier) ---- */
  const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const SPRING_BOUNCE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  const DURATION = {
    fast:   180,
    normal: 340,
    slow:   500,
    page:   420,
  };

  /* ==== 1. PAGE TRANSITIONS (Shop ↔ Product) ==== */

  function transitionToProduct(pageShop, pageProduct, callback) {
    // Capture scroll position
    const scrollY = window.scrollY;
    pageShop.dataset.scrollY = scrollY;

    // Set up outgoing page
    pageShop.style.transition = `opacity ${DURATION.page}ms ${SPRING}, transform ${DURATION.page}ms ${SPRING}`;
    pageShop.style.opacity = '1';
    pageShop.style.transform = 'translateX(0) scale(1)';
    pageShop.style.willChange = 'opacity, transform';

    // Set up incoming page — start off-screen right
    pageProduct.style.display = 'block';
    pageProduct.style.opacity = '0';
    pageProduct.style.transform = 'translateX(60px) scale(0.98)';
    pageProduct.style.willChange = 'opacity, transform';
    pageProduct.style.transition = 'none';

    requestAnimationFrame(() => {
      // Animate out shop
      pageShop.style.opacity = '0';
      pageShop.style.transform = 'translateX(-40px) scale(0.98)';
      pageShop.style.pointerEvents = 'none';

      // Small delay then slide in product
      requestAnimationFrame(() => {
        pageProduct.style.transition = `opacity ${DURATION.page}ms ${SPRING}, transform ${DURATION.page}ms ${SPRING}`;
        pageProduct.style.opacity = '1';
        pageProduct.style.transform = 'translateX(0) scale(1)';
        window.scrollTo({ top: 0, behavior: 'instant' });
      });

      setTimeout(() => {
        pageShop.style.display = 'none';
        pageShop.style.willChange = '';
        pageShop.style.pointerEvents = '';
        pageProduct.style.willChange = '';
        // Clean inline styles but keep display
        cleanTransformStyles(pageProduct);
        if (callback) callback();
      }, DURATION.page + 60);
    });
  }

  function transitionToShop(pageProduct, pageShop) {
    const savedScroll = parseInt(pageShop.dataset.scrollY || '0', 10);

    // Outgoing product — slide right
    pageProduct.style.transition = `opacity ${DURATION.page}ms ${SPRING}, transform ${DURATION.page}ms ${SPRING}`;
    pageProduct.style.willChange = 'opacity, transform';
    pageProduct.style.opacity = '1';
    pageProduct.style.transform = 'translateX(0) scale(1)';

    // Prep shop — starts off-screen left
    pageShop.style.display = 'block';
    pageShop.style.opacity = '0';
    pageShop.style.transform = 'translateX(-40px) scale(0.98)';
    pageShop.style.willChange = 'opacity, transform';
    pageShop.style.transition = 'none';
    pageShop.style.pointerEvents = 'none';

    requestAnimationFrame(() => {
      // Slide product out right
      pageProduct.style.opacity = '0';
      pageProduct.style.transform = 'translateX(60px) scale(0.98)';

      requestAnimationFrame(() => {
        pageShop.style.transition = `opacity ${DURATION.page}ms ${SPRING}, transform ${DURATION.page}ms ${SPRING}`;
        pageShop.style.opacity = '1';
        pageShop.style.transform = 'translateX(0) scale(1)';
        pageShop.style.pointerEvents = '';
        window.scrollTo({ top: savedScroll, behavior: 'instant' });
      });

      setTimeout(() => {
        pageProduct.style.display = 'none';
        cleanTransformStyles(pageProduct);
        cleanTransformStyles(pageShop);
        pageProduct.style.willChange = '';
        pageShop.style.willChange = '';
      }, DURATION.page + 60);
    });
  }

  function cleanTransformStyles(el) {
    el.style.transform = '';
    el.style.opacity = '';
    el.style.transition = '';
  }


  /* ==== 2. MODAL ENTRANCE / EXIT ==== */

  function openOverlay(overlay, modal, type = 'center') {
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    overlay.style.transition = `opacity ${DURATION.normal}ms ease`;

    if (modal) {
      if (type === 'center') {
        modal.style.opacity = '0';
        modal.style.transform = 'scale(0.92) translateY(20px)';
        modal.style.transition = 'none';
      } else if (type === 'bottom') {
        modal.style.opacity = '0';
        modal.style.transform = 'translateY(40px)';
        modal.style.transition = 'none';
      }
    }

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';

      if (modal) {
        requestAnimationFrame(() => {
          modal.style.transition = `opacity ${DURATION.slow}ms ${SPRING}, transform ${DURATION.slow}ms ${SPRING_BOUNCE}`;
          modal.style.opacity = '1';
          modal.style.transform = 'scale(1) translateY(0)';
        });
      }

      // Clean up will-change after animation
      setTimeout(() => {
        if (modal) modal.style.willChange = '';
      }, DURATION.slow + 100);
    });
  }

  function closeOverlay(overlay, modal, onDone) {
    if (!overlay) return;

    overlay.style.transition = `opacity ${DURATION.normal}ms ease`;

    if (modal) {
      modal.style.transition = `opacity ${DURATION.fast}ms ease, transform ${DURATION.fast}ms ease`;
      modal.style.opacity = '0';
      modal.style.transform = 'scale(0.95) translateY(10px)';
    }

    // Slight delay then fade overlay
    setTimeout(() => {
      overlay.style.opacity = '0';
    }, 40);

    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.style.opacity = '';
      overlay.style.transition = '';
      if (modal) {
        modal.style.opacity = '';
        modal.style.transform = '';
        modal.style.transition = '';
      }
      if (onDone) onDone();
    }, DURATION.normal + 60);
  }


  /* ==== 3. SCROLL-AWARE NAVBAR ==== */

  function initNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    let lastY = 0;
    let ticking = false;
    let hidden = false;
    const threshold = 8;    // pixels to scroll before reacting
    const topZone = 100;    // always show when near top

    // Add transition for transform
    navbar.style.transition = `transform 0.35s ${SPRING}, background 0.45s ${SPRING}, border-color 0.45s ${SPRING}`;

    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;

        if (y <= topZone) {
          // Always show near top
          if (hidden) {
            navbar.style.transform = 'translateY(0)';
            hidden = false;
          }
        } else if (delta > threshold && !hidden) {
          // Scrolling down — hide
          navbar.style.transform = 'translateY(-100%)';
          hidden = true;
        } else if (delta < -threshold && hidden) {
          // Scrolling up — show
          navbar.style.transform = 'translateY(0)';
          hidden = false;
        }

        lastY = y;
        ticking = false;
      });
    }, { passive: true });
  }


  /* ==== 4. BUTTON PRESS FEEL (tap-scale) ==== */

  function initButtonPress() {
    // All interactive buttons get a press feel
    const selectors = [
      '.btn-neon', '.btn-checkout', '.btn-icon', '.cart-close',
      '.product-card', '.color-btn', '.size-btn',
      '.ai-gen-submit-btn', '.badge-pill', '.filter-chip',
      '.dl-btn-lock', '.pd-add-to-cart-btn', '.btn-secondary',
      '.quick-add-btn', '#ai-regen-btn'
    ];

    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest(selectors.join(','));
      if (!btn) return;
      btn.style.transition = 'transform 0.1s ease';
      btn.style.transform = 'scale(0.96)';
    }, { passive: true });

    document.addEventListener('pointerup', releaseButton, { passive: true });
    document.addEventListener('pointerleave', releaseButton, { passive: true });
    document.addEventListener('pointercancel', releaseButton, { passive: true });

    function releaseButton(e) {
      const btn = e.target.closest(selectors.join(','));
      if (!btn) return;
      btn.style.transition = 'transform 0.3s ' + SPRING_BOUNCE;
      btn.style.transform = 'scale(1)';
      // Clean after spring back
      setTimeout(() => {
        btn.style.transform = '';
        btn.style.transition = '';
      }, 350);
    }
  }


  /* ==== 5. CARD STAGGER ANIMATION ==== */

  function staggerCards(container, selector = '.product-card') {
    const cards = container.querySelectorAll(selector);
    cards.forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(24px) scale(0.97)';
      card.style.transition = 'none';

      requestAnimationFrame(() => {
        setTimeout(() => {
          card.style.transition = `opacity 0.5s ${SPRING}, transform 0.5s ${SPRING}`;
          card.style.opacity = '1';
          card.style.transform = 'translateY(0) scale(1)';

          // Cleanup
          setTimeout(() => {
            card.style.opacity = '';
            card.style.transform = '';
            card.style.transition = '';
          }, 600);
        }, i * 60); // 60ms stagger per card
      });
    });
  }


  /* ==== 6. AI RESULT CARD APPEAR ==== */

  function staggerResultCards(grid) {
    if (!grid) return;
    const cards = grid.querySelectorAll('.ai-result-card');
    cards.forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px) scale(0.96)';
      card.style.transition = 'none';

      requestAnimationFrame(() => {
        setTimeout(() => {
          card.style.transition = `opacity 0.45s ${SPRING}, transform 0.45s ${SPRING}`;
          card.style.opacity = '1';
          card.style.transform = 'translateY(0) scale(1)';

          setTimeout(() => {
            card.style.opacity = '';
            card.style.transform = '';
            card.style.transition = '';
          }, 550);
        }, i * 80);
      });
    });
  }


  /* ==== 7. RECOMMENDED CARD GLOW PULSE ==== */

  function initRecommendedPulse() {
    // MutationObserver to catch when .best-match label appears
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.ai-result-card').forEach(card => {
        if (card.querySelector('.best-match-label')) {
          card.classList.add('pp-recommended');
        }
      });
    });

    const grid = document.getElementById('ai-results-grid');
    if (grid) {
      observer.observe(grid, { childList: true, subtree: true });
    }
  }


  /* ==== 8. SAVE CHECKMARK ANIMATION ==== */

  function showSaveCheck(buttonEl) {
    if (!buttonEl) return;
    const originalHTML = buttonEl.innerHTML;
    const originalWidth = buttonEl.offsetWidth;

    buttonEl.style.minWidth = originalWidth + 'px';
    buttonEl.innerHTML = '<span class="pp-checkmark">✓</span>';
    buttonEl.classList.add('pp-saved');

    setTimeout(() => {
      buttonEl.innerHTML = originalHTML;
      buttonEl.classList.remove('pp-saved');
      buttonEl.style.minWidth = '';
    }, 1600);
  }


  /* ==== 9. REGENERATE BLUR-REFRESH ==== */

  function blurRefresh(grid, renderFn) {
    if (!grid) return;
    // Blur out current cards
    grid.style.transition = `filter 0.2s ease, opacity 0.2s ease`;
    grid.style.filter = 'blur(6px)';
    grid.style.opacity = '0.4';

    setTimeout(() => {
      // Render new content
      if (renderFn) renderFn();
      // Unblur with fresh cards
      grid.style.transition = `filter 0.4s ${SPRING}, opacity 0.35s ease`;
      grid.style.filter = 'blur(0px)';
      grid.style.opacity = '1';

      // Clean up
      setTimeout(() => {
        grid.style.filter = '';
        grid.style.opacity = '';
        grid.style.transition = '';
      }, 500);
    }, 250);
  }


  /* ==== 10. ATTENTION PULSE ON CTA ==== */

  function initCtaPulse() {
    // Subtle scale-brightness pulse every 6s on main CTA buttons
    const ctas = document.querySelectorAll('.hero-cta .btn-neon, .lab-entry-cta .btn-neon');
    ctas.forEach(btn => {
      btn.classList.add('pp-cta-pulse');
    });
  }


  /* ==== 11. HAPTIC-STYLE TOUCH FEEDBACK ==== */

  function initTouchFeedback() {
    // Vibrate on tap for supported devices (very short, feels native)
    document.addEventListener('pointerdown', e => {
      const interactive = e.target.closest('button, .product-card, .color-btn, .size-btn, a[href]');
      if (!interactive) return;
      if (navigator.vibrate) {
        navigator.vibrate(8); // 8ms micro-vibration
      }
    }, { passive: true });
  }


  /* ==== 12. OVERSCROLL CONTAINMENT ==== */

  function initOverscrollContain() {
    // Prevent pull-to-refresh and rubber-banding on panels/modals
    const panels = ['.cart-panel', '.dl-modal', '.ai-gen-modal', '.sl-modal', '.checkout-modal'];
    panels.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        el.style.overscrollBehavior = 'contain';
        el.style.webkitOverflowScrolling = 'touch';
      }
    });
  }


  /* ==== 13. REDUCED MOTION DETECTION ==== */

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }


  /* ==== INIT ALL ==== */

  function init() {
    // Respect accessibility
    if (prefersReducedMotion()) return;

    initNavbarScroll();
    initButtonPress();
    initRecommendedPulse();
    initCtaPulse();
    initTouchFeedback();
    initOverscrollContain();

    // Stagger product cards on first load
    const grid = document.getElementById('product-grid');
    if (grid) {
      // Wait for cards to render, then stagger
      const waitForCards = setInterval(() => {
        if (grid.children.length > 0) {
          clearInterval(waitForCards);
          staggerCards(grid);
        }
      }, 100);
      // Safety: stop waiting after 3s
      setTimeout(() => clearInterval(waitForCards), 3000);
    }
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already ready — slight delay to let other scripts set up
    setTimeout(init, 50);
  }

  /* ==== PUBLIC API ==== */
  return {
    transitionToProduct,
    transitionToShop,
    openOverlay,
    closeOverlay,
    staggerCards,
    staggerResultCards,
    blurRefresh,
    showSaveCheck,
    prefersReducedMotion,
    DURATION,
  };

})();
