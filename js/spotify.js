// Spotify: Authorization Code with PKCE (no backend), now-playing polling,
// playback controls. Handles the iOS standalone/Safari handoff gotcha.

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

const LS = {
  clientId: 'slemdrive.sp.clientId',
  verifier: 'slemdrive.sp.verifier',
  tokens: 'slemdrive.sp.tokens',
};

export function redirectUri() {
  return location.origin + location.pathname;
}

// ---------- PKCE helpers ----------

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const vals = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(vals, (v) => chars[v % chars.length]).join('');
}

async function sha256base64url(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- service ----------

export class SpotifyService {
  constructor() {
    this.tokens = this.loadTokens();
    this.onTrack = null;      // callback(track|null) on track change
    this.onPlayback = null;   // callback({isPlaying, progressMs, fetchedAt, durationMs})
    this.onAuthChange = null; // callback(connected: boolean)
    this.onToast = null;
    this.pollTimer = null;
    this.lastTrackId = null;
    this.polling = false;
    this.isPlaying = false;
    this.lastPlayback = null;   // last known playback, for optimistic updates
    this.rateLimitedUntil = 0;
  }

  get clientId() { return localStorage.getItem(LS.clientId) || ''; }
  set clientId(v) { localStorage.setItem(LS.clientId, v.trim()); }
  get connected() { return !!(this.tokens && this.tokens.refresh_token); }

  loadTokens() {
    try { return JSON.parse(localStorage.getItem(LS.tokens)); } catch { return null; }
  }
  saveTokens(t) {
    this.tokens = t;
    if (t) localStorage.setItem(LS.tokens, JSON.stringify(t));
    else localStorage.removeItem(LS.tokens);
    if (this.onAuthChange) this.onAuthChange(this.connected);
  }

  // ---------- auth flow ----------

  async login() {
    if (!this.clientId) { this.toast('Bitte zuerst die Client-ID eintragen.'); return; }
    const verifier = randomString(64);
    localStorage.setItem(LS.verifier, verifier);
    const challenge = await sha256base64url(verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    location.href = `${AUTH_URL}?${params}`;
  }

  // Call on app boot. Returns 'exchanged' | 'stranded' | null.
  // 'stranded' = we have a ?code= but no verifier (iOS returned to Safari
  // instead of the home-screen app) -> show the copy-code screen.
  async handleRedirect() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      history.replaceState(null, '', redirectUri());
      this.toast('Spotify-Login abgebrochen: ' + error);
      return null;
    }
    if (!code) return null;
    history.replaceState(null, '', redirectUri());

    const verifier = localStorage.getItem(LS.verifier);
    if (!verifier) return { status: 'stranded', code };

    const ok = await this.exchangeCode(code, verifier);
    return ok ? { status: 'exchanged' } : null;
  }

  // Exchange a pasted code ("Login hängt?" path) with our own verifier.
  async exchangePastedCode(code) {
    const verifier = localStorage.getItem(LS.verifier);
    if (!verifier) { this.toast('Kein Login-Versuch gefunden. Bitte zuerst „Verbinden" tippen.'); return false; }
    return this.exchangeCode(code.trim(), verifier);
  }

  async exchangeCode(code, verifier) {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(),
          client_id: this.clientId,
          code_verifier: verifier,
        }),
      });
      if (!res.ok) throw new Error('token ' + res.status);
      const t = await res.json();
      t.expires_at = Date.now() + (t.expires_in - 60) * 1000;
      this.saveTokens(t);
      localStorage.removeItem(LS.verifier);
      this.toast('Spotify verbunden ✓');
      return true;
    } catch (e) {
      this.toast('Spotify-Login fehlgeschlagen. Client-ID und Redirect-URI prüfen.');
      return false;
    }
  }

  async refreshIfNeeded() {
    if (!this.tokens) return false;
    if (Date.now() < this.tokens.expires_at) return true;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refresh_token,
          client_id: this.clientId,
        }),
      });
      if (!res.ok) throw new Error('refresh ' + res.status);
      const t = await res.json();
      t.expires_at = Date.now() + (t.expires_in - 60) * 1000;
      // refresh tokens may rotate — keep the old one if none returned
      if (!t.refresh_token) t.refresh_token = this.tokens.refresh_token;
      this.saveTokens(t);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.saveTokens(null);
    this.stopPolling();
    this.lastTrackId = null;
    if (this.onTrack) this.onTrack(null);
  }

  // ---------- API ----------

  async api(path, opts = {}) {
    if (Date.now() < this.rateLimitedUntil) return null;
    if (!(await this.refreshIfNeeded())) return null;
    const res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + this.tokens.access_token, ...(opts.headers || {}) },
    });
    if (res.status === 401) {
      this.tokens.expires_at = 0; // force refresh next call
      return null;
    }
    if (res.status === 403) {
      this.toast('Dafür wird Spotify Premium benötigt.');
      return { failed: true };
    }
    if (res.status === 404) {
      // no active device — Spotify needs a device that is currently playing
      this.toast('Kein aktives Spotify-Gerät. Song in der Spotify-App kurz starten.');
      return { failed: true };
    }
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('Retry-After') || '5', 10);
      this.rateLimitedUntil = Date.now() + retry * 1000;
      return null;
    }
    if (res.status === 204) return { empty: true };
    if (!res.ok) return null;
    return res.json().catch(() => ({ empty: true }));
  }

  // ---------- polling ----------

  startPolling() {
    if (!this.connected) return;
    this.polling = true;
    this.pollOnce();
  }
  stopPolling() {
    this.polling = false;
    clearTimeout(this.pollTimer);
  }

  schedule(ms) {
    clearTimeout(this.pollTimer);
    if (!this.polling) return;
    this.pollTimer = setTimeout(() => this.pollOnce(), ms);
  }

  async pollOnce() {
    if (!this.polling || document.hidden) return;
    const t0 = Date.now();
    const data = await this.api('/me/player/currently-playing');
    const mid = (t0 + Date.now()) / 2; // fetch midpoint for interpolation

    if (data && data.failed) {
      // a rejected request says nothing about playback — keep what we show
      this.schedule(3000);
      return;
    }

    if (!data || data.empty || !data.item) {
      this.isPlaying = false;
      if (this.lastTrackId !== null) {
        this.lastTrackId = null;
        if (this.onTrack) this.onTrack(null);
      }
      this.lastPlayback = { isPlaying: false, progressMs: 0, fetchedAt: mid, durationMs: 0 };
      if (this.onPlayback) this.onPlayback(this.lastPlayback);
      this.schedule(3000);
      return;
    }

    const item = data.item;
    this.isPlaying = !!data.is_playing;
    if (item.id !== this.lastTrackId) {
      this.lastTrackId = item.id;
      if (this.onTrack) {
        this.onTrack({
          id: item.id,
          title: item.name,
          artist: (item.artists || []).map((a) => a.name).join(', '),
          album: item.album ? item.album.name : '',
          durationMs: item.duration_ms,
          cover: item.album && item.album.images && item.album.images.length
            ? (item.album.images[1] || item.album.images[0]).url : null,
        });
      }
    }
    this.lastPlayback = {
      isPlaying: this.isPlaying,
      progressMs: data.progress_ms || 0,
      fetchedAt: mid,
      durationMs: item.duration_ms,
    };
    if (this.onPlayback) this.onPlayback(this.lastPlayback);
    this.schedule(this.isPlaying ? 1000 : 3000);
  }

  // ---------- controls ----------

  async control(action) {
    if (!this.connected) return;
    const map = {
      play: ['/me/player/play', 'PUT'],
      pause: ['/me/player/pause', 'PUT'],
      next: ['/me/player/next', 'POST'],
      prev: ['/me/player/previous', 'POST'],
    };
    const [path, method] = map[action];
    const res = await this.api(path, { method });

    if (res && res.failed) {
      // command rejected: undo the optimistic UI so the icon tells the truth
      this.pollOnce();
      return;
    }

    // Spotify's state is eventually consistent — a single poll 300 ms later
    // often still reports the old is_playing. Poll a few times instead.
    for (const ms of [350, 1000, 2200]) setTimeout(() => this.pollOnce(), ms);
  }

  togglePlay() {
    const wantPlaying = !this.isPlaying;
    // optimistic: flip locally right away so the button feels instant
    this.isPlaying = wantPlaying;
    const p = this.lastPlayback;
    if (this.onPlayback && p) {
      // carry the interpolated position over so the progress bar doesn't jump
      const elapsed = p.isPlaying ? Date.now() - p.fetchedAt : 0;
      this.lastPlayback = {
        ...p,
        isPlaying: wantPlaying,
        progressMs: Math.min(p.progressMs + elapsed, p.durationMs || Infinity),
        fetchedAt: Date.now(),
      };
      this.onPlayback(this.lastPlayback);
    }
    this.control(wantPlaying ? 'play' : 'pause');
  }

  toast(msg) { if (this.onToast) this.onToast(msg); }
}
