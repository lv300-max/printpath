/**
 * firebase-auth.js
 * ─────────────────────────────────────────────────────────────
 * PrintPath — Firebase Google Sign-In
 *
 * HOW TO CONFIGURE:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a project (or open your existing one)
 * 3. Click "Add app" → choose Web (</>)
 * 4. Copy the firebaseConfig object and paste it below
 * 5. In Firebase Console → Authentication → Sign-in method → enable Google
 * 6. In Firebase Console → Authentication → Settings → Authorized domains
 *    → add: printpath-ai.netlify.app
 * ─────────────────────────────────────────────────────────────
 */

import { initializeApp }            from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
// ─────────────────────────────────────────────────────────────

// Detect placeholder — fall back to demo mode gracefully
const isConfigured = firebaseConfig.apiKey !== 'YOUR_API_KEY';

if (!isConfigured) {
  console.warn('[PrintPath] Firebase not configured. Running in demo mode — sign-in will use a local demo user.');
  // Mark as not ready so handleGoogleSignIn() in the HTML falls back
  window._firebaseReady = false;
} else {
  // Initialise Firebase
  const app      = initializeApp(firebaseConfig);
  const auth     = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  window._firebaseReady = true;

  // ── Sign out helper exposed to window ──
  window._firebaseSignOut = () => signOut(auth);

  // ── Google sign-in (called by btn-google-signin click) ──
  window.handleGoogleSignIn = async () => {
    const btn = document.getElementById('btn-google-signin');
    if (btn) {
      btn.classList.add('loading');
      btn.textContent = ' Signing in…';
    }
    try {
      await signInWithPopup(auth, provider);
      // onAuthStateChanged will fire → calls onAuthSuccess
    } catch (err) {
      if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = `
          <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;flex-shrink:0">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.332 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.314 0-9.629-3.317-11.29-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a11.996 11.996 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
          Sign in with Google`;
      }
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('[PrintPath] Sign-in error:', err.message);
      }
    }
  };

  // ── Auth state observer ──
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.onAuthSuccess?.(user);
    } else {
      window.onAuthSignedOut?.();
    }
  });
}
