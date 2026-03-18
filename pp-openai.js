/* ============================================================
   PrintPath — OpenAI Prompt Cleaner (Client)
   ────────────────────────────────────────────────────────────
   Talks to the PrintPath backend server (/clean-prompt) which
   handles the OpenAI call server-side. API key never touches
   the browser.

   Pipeline:  userText
     → ppOpenAI.clean(userText)   — POST to server
     → ppAnalyzePrompt()          ← existing (ai-gen.js)
     → ppBuildPrompt()            ← existing (ai-gen.js)
     → generateDesign()           ← existing (ai-gen.js)

   Falls back to the local regex pipeline if:
     - Server is not running
     - Network fails
     - Response is malformed
   ============================================================ */

'use strict';

const ppOpenAI = (() => {

  /* ── Config ──────────────────────────────────────────────── */
  const CONFIG = {
    serverUrl:  '',          // relative — works on Netlify + locally via netlify dev
    endpoint:   '/clean-prompt',
    healthPath: '/health',
    timeout:    10000,   // 10s — server + OpenAI round-trip
  };

  /* ── Server status (cached for the session) ──────────────── */
  let _serverOnline = null;  // null = unknown, true/false = checked

  /**
   * checkServer() → Promise<boolean>
   * Pings /health to see if the backend is available.
   */
  async function checkServer() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(CONFIG.serverUrl + CONFIG.healthPath, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { _serverOnline = false; return false; }
      const data = await res.json();
      _serverOnline = data.status === 'ok' && data.hasKey === true;
      return _serverOnline;
    } catch {
      _serverOnline = false;
      return false;
    }
  }

  /**
   * isOnline() — returns cached status, or null if not checked yet.
   */
  function isOnline() {
    return _serverOnline;
  }

  /**
   * hasKey() — for backward compat with ai-gen.js checks.
   * Returns true if server is confirmed online with a valid key.
   */
  function hasKey() {
    return _serverOnline === true;
  }

  /* ── Core: clean prompt via server ───────────────────────── */

  /**
   * clean(rawInput) → Promise<CleanResult>
   *
   * CleanResult: {
   *   subject:    string,
   *   style:      string|null,
   *   cleaned:    string,
   *   unclear:    boolean,
   *   suggestion: string|null,
   *   source:     'openai' | 'local'
   * }
   */
  async function clean(rawInput) {
    const trimmed = (rawInput || '').trim();
    if (!trimmed) {
      return {
        subject: '', style: null, cleaned: '',
        unclear: true,
        suggestion: 'Describe what you want — like "a lion" or "best dad ever".',
        source: 'local',
      };
    }

    // If server is confirmed offline, skip the call
    if (_serverOnline === false) {
      return localClean(trimmed);
    }

    // If we haven't checked yet, do a quick health check first
    if (_serverOnline === null) {
      await checkServer();
      if (!_serverOnline) return localClean(trimmed);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONFIG.timeout);

      const res = await fetch(CONFIG.serverUrl + CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.warn('[PrintPath] Server error:', errData.error || res.status);
        if (res.status === 401) _serverOnline = false;
        return localClean(trimmed);
      }

      const result = await res.json();

      // Validate
      if (result && typeof result.subject === 'string' && typeof result.cleaned === 'string') {
        result.source = result.source || 'openai';
        return result;
      }

      console.warn('[PrintPath] Malformed server response, using local fallback');
      return localClean(trimmed);

    } catch (err) {
      console.warn('[PrintPath] Server unreachable, using local fallback:', err.message);
      _serverOnline = false;
      return localClean(trimmed);
    }
  }


  /* ── Local fallback (regex pipeline) ─────────────────────── */

  function localClean(rawInput) {
    const subject = (typeof ppSanitizeInput === 'function')
      ? ppSanitizeInput(rawInput)
      : rawInput.replace(/\b(please|make|create|draw|generate|design|show me|i want|give me|can you|could you|just|really|very|super|like|with|for|shirt|tee|tshirt|t-shirt|hoodie|print|something|thing|stuff|cool|nice|awesome|amazing|great|good|put|on|it|my|me|that|this|some|have|need|get)\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();

    let style = null;
    const styleMatch = rawInput.match(/\b(minimal|bold|cartoon|realistic|funny|retro)\b/i);
    if (styleMatch) style = styleMatch[1].toLowerCase();

    return {
      subject,
      style,
      cleaned: style ? `${style} ${subject}` : subject,
      unclear: subject.length < 2,
      suggestion: subject.length < 2
        ? 'Try describing what you want — like "a lion" or "best dad ever".'
        : null,
      source: 'local',
    };
  }


  /* ── Public API ──────────────────────────────────────────── */
  return {
    clean,
    checkServer,
    isOnline,
    hasKey,
    CONFIG,
  };

})();
