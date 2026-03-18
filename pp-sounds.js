/**
 * PrintPath Micro Sound Engine
 * ─────────────────────────────────────────────────────────────
 * All sounds are synthesized via Web Audio API — no MP3 files needed.
 * Sounds are: short (<0.5s), low volume, non-overlapping, interaction-only.
 *
 * Public API:
 *   ppSound.play('tick')
 *   ppSound.play('whoosh')
 *   ppSound.play('ding')
 *   ppSound.play('snap')
 *   ppSound.play('thud')
 *   ppSound.play('shuffle')
 *   ppSound.enabled   → boolean
 *   ppSound.toggle()  → toggles on/off, persists to localStorage
 */

const ppSound = (() => {
  /* ── State ───────────────────────────────────────────────── */
  const STORAGE_KEY = 'pp-sound-enabled';
  let _enabled = localStorage.getItem(STORAGE_KEY) !== 'false'; // default on
  let _ctx = null;    // AudioContext — created lazily on first interaction
  let _playing = false; // prevent stacking

  /* ── Lazy AudioContext ───────────────────────────────────── */
  function _ctx_get() {
    if (!_ctx) {
      try {
        _ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return null;
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  /* ── Core tone builder ───────────────────────────────────── */
  /**
   * _tone(opts)
   * @param {Object} opts
   * @param {number}   opts.freq       — Start frequency in Hz
   * @param {number}   [opts.freqEnd]  — End frequency (for sweep). Default = freq
   * @param {string}   [opts.type]     — OscillatorType. Default 'sine'
   * @param {number}   [opts.dur]      — Duration in seconds. Default 0.18
   * @param {number}   [opts.vol]      — Peak gain 0–1. Default 0.18
   * @param {number}   [opts.attack]   — Attack time in seconds. Default 0.004
   * @param {number}   [opts.decay]    — Decay time in seconds. Default dur * 0.85
   * @param {number}   [opts.delay]    — Start delay in seconds. Default 0
   * @param {boolean}  [opts.noise]    — Mix in white noise. Default false
   */
  function _tone(opts = {}) {
    const ctx = _ctx_get();
    if (!ctx) return;

    const {
      freq     = 440,
      freqEnd  = freq,
      type     = 'sine',
      dur      = 0.18,
      vol      = 0.18,
      attack   = 0.004,
      decay    = dur * 0.85,
      delay    = 0,
      noise    = false,
    } = opts;

    const now    = ctx.currentTime + delay;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(vol, now + attack);
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    master.connect(ctx.destination);

    if (noise) {
      // White noise burst
      const bufLen    = ctx.sampleRate * dur;
      const buffer    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data      = buffer.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src       = ctx.createBufferSource();
      src.buffer      = buffer;
      // Low-pass to soften
      const lpf       = ctx.createBiquadFilter();
      lpf.type        = 'lowpass';
      lpf.frequency.value = 800;
      src.connect(lpf);
      lpf.connect(master);
      src.start(now);
      src.stop(now + dur);
    } else {
      const osc       = ctx.createOscillator();
      osc.type        = type;
      osc.frequency.setValueAtTime(freq, now);
      if (freqEnd !== freq) {
        osc.frequency.exponentialRampToValueAtTime(freqEnd, now + dur);
      }
      osc.connect(master);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    }
  }

  /* ── Sound Definitions ───────────────────────────────────── */
  const SOUNDS = {

    /**
     * tick — soft mechanical click for button taps
     * Short noise transient + quick high sine
     */
    tick() {
      _tone({ noise: true, dur: 0.04, vol: 0.10, attack: 0.001 });
      _tone({ freq: 1800, freqEnd: 1200, type: 'sine', dur: 0.06, vol: 0.06, attack: 0.001 });
    },

    /**
     * whoosh — air sweep for design generated
     * Rising noise sweep + bright click
     */
    whoosh() {
      _tone({ freq: 180, freqEnd: 900, type: 'sine', dur: 0.28, vol: 0.12, attack: 0.01 });
      _tone({ noise: true, dur: 0.22, vol: 0.08, attack: 0.005 });
      // Tiny click at the end
      _tone({ freq: 2400, freqEnd: 1600, type: 'sine', dur: 0.06, vol: 0.07, delay: 0.22 });
    },

    /**
     * ding — clean high note for print-ready badge
     * Pure sine with long natural decay
     */
    ding() {
      _tone({ freq: 1047, type: 'sine', dur: 0.45, vol: 0.16, attack: 0.003, decay: 0.42 });
      _tone({ freq: 1568, type: 'sine', dur: 0.30, vol: 0.07, attack: 0.003, delay: 0.01 });
    },

    /**
     * snap — soft lock/snap for save
     * Quick downward transient
     */
    snap() {
      _tone({ freq: 900, freqEnd: 200, type: 'triangle', dur: 0.10, vol: 0.14, attack: 0.001 });
      _tone({ noise: true, dur: 0.05, vol: 0.09, attack: 0.001, delay: 0.01 });
    },

    /**
     * thud — soft low thud for continue/add to cart
     * Sub-bass bump
     */
    thud() {
      _tone({ freq: 140, freqEnd: 60, type: 'sine', dur: 0.20, vol: 0.20, attack: 0.005 });
      _tone({ noise: true, dur: 0.06, vol: 0.06, attack: 0.001 });
    },

    /**
     * shuffle — quick swipe for regenerate
     * Falling noise sweep
     */
    shuffle() {
      _tone({ freq: 600, freqEnd: 200, type: 'sine', dur: 0.18, vol: 0.10, attack: 0.005 });
      _tone({ noise: true, dur: 0.14, vol: 0.07, attack: 0.003, delay: 0.02 });
    },
  };

  /* ── Public play() ───────────────────────────────────────── */
  function play(name) {
    if (!_enabled) return;
    if (_playing) return;           // don't stack sounds
    const fn = SOUNDS[name];
    if (!fn) return;

    _playing = true;
    fn();
    // Allow next sound after 300ms minimum gap
    setTimeout(() => { _playing = false; }, 300);
  }

  /* ── Toggle on/off ───────────────────────────────────────── */
  function toggle() {
    _enabled = !_enabled;
    localStorage.setItem(STORAGE_KEY, _enabled);
    _updateToggleUI();
    // Play a tick as confirmation only when enabling
    if (_enabled) { setTimeout(() => play('tick'), 80); }
    return _enabled;
  }

  function _updateToggleUI() {
    const btn = document.getElementById('pp-sound-toggle');
    if (!btn) return;
    btn.setAttribute('aria-label', _enabled ? 'Mute sounds' : 'Enable sounds');
    btn.setAttribute('title', _enabled ? 'Sound: On' : 'Sound: Off');
    btn.classList.toggle('sound-off', !_enabled);
    const iconOn  = btn.querySelector('.sound-icon-on');
    const iconOff = btn.querySelector('.sound-icon-off');
    if (iconOn)  iconOn.style.display  = _enabled ? '' : 'none';
    if (iconOff) iconOff.style.display = _enabled ? 'none' : '';
  }

  /* ── Init: wire toggle button when DOM is ready ─────────── */
  function init() {
    const btn = document.getElementById('pp-sound-toggle');
    if (btn) {
      btn.addEventListener('click', toggle);
      _updateToggleUI();
    }
    // Unlock AudioContext on first user interaction anywhere
    const unlock = () => { _ctx_get(); document.removeEventListener('pointerdown', unlock); };
    document.addEventListener('pointerdown', unlock, { once: true });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { play, toggle, get enabled() { return _enabled; } };
})();
