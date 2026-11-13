// Theme engine + music-reactive colors: album-art palette extraction,
// lyric pulse, microphone beat mode, BPM pulse, speed reactivity.

const root = document.documentElement;

// ---------- palette extraction (median-cut-ish on a tiny canvas) ----------

// Extract up to 3 vibrant colors from an image element.
export function extractPalette(img) {
  const S = 40;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0, S, S);
  } catch { return null; }
  let data;
  try { data = ctx.getImageData(0, 0, S, S).data; }
  catch { return null; } // canvas tainted (no CORS)

  // collect candidate pixels, skip near-black/near-white/grey
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const light = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(2 * light - 255) || 1);
    if (light < 25 || light > 235) continue;
    if (sat < 0.12) continue;
    px.push([r, g, b, sat * (1 - Math.abs(light - 128) / 160)]); // vibrance weight
  }
  if (px.length < 10) return null;

  // k-means, k=3, few iterations, weighted by vibrance
  let centers = [px[0], px[(px.length / 2) | 0], px[px.length - 1]].map((p) => p.slice(0, 3));
  for (let iter = 0; iter < 6; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = (p[0] - centers[c][0]) ** 2 + (p[1] - centers[c][1]) ** 2 + (p[2] - centers[c][2]) ** 2;
        if (d < bd) { bd = d; bi = c; }
      }
      const w = p[3];
      sums[bi][0] += p[0] * w; sums[bi][1] += p[1] * w; sums[bi][2] += p[2] * w; sums[bi][3] += w;
    }
    centers = sums.map((s, i) => s[3] > 0
      ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
      : centers[i]);
  }
  return centers.map((c) => c.map(Math.round));
}

function rgbHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

// Lighten a color enough to read as an accent on near-black.
function toAccent([r, g, b]) {
  const max = Math.max(r, g, b, 1);
  const boost = Math.min(255 / max, 2.2);
  const f = (v) => Math.round(Math.min(255, v * boost * 0.92 + 30));
  return [f(r), f(g), f(b)];
}
// Darken for background blobs.
function toBlob([r, g, b], f = 0.42) {
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

// ---------- theme application ----------

export function applyAccentVars({ accent, accent2, blob1, blob2, blob3 }) {
  if (accent) root.style.setProperty('--accent', accent);
  if (accent2) root.style.setProperty('--accent2', accent2);
  if (blob1) root.style.setProperty('--blob1', blob1);
  if (blob2) root.style.setProperty('--blob2', blob2);
  if (blob3) root.style.setProperty('--blob3', blob3);
}

// Apply a palette extracted from album art (bgMode 'album').
export function applyAlbumPalette(img) {
  const pal = extractPalette(img);
  if (!pal) return false;
  const [a, b, c] = pal;
  applyAccentVars({
    accent: rgbHex(toAccent(a)),
    accent2: rgbHex(toAccent(b)),
    blob1: rgbHex(toBlob(a)),
    blob2: rgbHex(toBlob(b)),
    blob3: rgbHex(toBlob(c, 0.3)),
  });
  return true;
}

// ---------- pulse (shared by lyric pulse / mic / bpm) ----------

let pulseLevel = 0;
let pulseDecay = null;

export function setPulse(v) {
  pulseLevel = Math.max(0, Math.min(1, v));
  root.style.setProperty('--pulse', pulseLevel.toFixed(3));
}

// One soft "breath": up fast, down slow (~400 ms total)
export function pulseOnce(strength = 0.8) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cancelAnimationFrame(pulseDecay);
  const t0 = performance.now();
  const tick = (t) => {
    const dt = (t - t0) / 420;
    if (dt >= 1) { setPulse(0); return; }
    // attack 0..0.18, release 0.18..1
    const v = dt < 0.18 ? dt / 0.18 : 1 - (dt - 0.18) / 0.82;
    setPulse(v * strength);
    pulseDecay = requestAnimationFrame(tick);
  };
  pulseDecay = requestAnimationFrame(tick);
}

// ---------- microphone beat mode ----------

export class MicBeat {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.raf = null;
    this.sensitivity = 1;
    this.smoothed = 0;
    this.lastUpdate = 0;
  }

  async start() {
    if (this.ctx) return true;
    try {
      // audio is processed locally only — never recorded or sent anywhere
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.loop();
    return true;
  }

  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    if (now - this.lastUpdate < 33) return; // cap ~30 updates/s
    this.lastUpdate = now;

    this.analyser.getByteFrequencyData(this.buf);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const lo = Math.max(1, Math.round(40 / binHz));
    const hi = Math.min(this.buf.length - 1, Math.round(150 / binHz));
    let bass = 0;
    for (let i = lo; i <= hi; i++) bass += this.buf[i];
    bass /= (hi - lo + 1) * 255;

    const target = Math.min(1, bass * 1.6 * this.sensitivity);
    // asymmetric smoothing: fast attack, slow release -> no flicker
    this.smoothed += (target - this.smoothed) * (target > this.smoothed ? 0.5 : 0.12);
    if (document.hidden) return;
    setPulse(this.smoothed);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.ctx = null; this.analyser = null; this.stream = null;
    setPulse(0);
  }
}

// ---------- BPM pulse ----------

export class BpmPulse {
  constructor() { this.timer = null; this.bpm = 0; }

  // GetSongBPM needs an API key; fall back silently if unavailable.
  async lookup(title, artist) {
    this.stop();
    try {
      // AudioDB is keyless for basic lookups (key "2" = public test key)
      const res = await fetch(`https://www.theaudiodb.com/api/v1/json/2/searchtrack.php?s=${encodeURIComponent(artist)}&t=${encodeURIComponent(title)}`);
      if (!res.ok) return;
      const json = await res.json();
      const bpm = json && json.track && json.track[0] && parseFloat(json.track[0].intTempo);
      if (bpm && bpm > 40 && bpm < 220) this.startPulse(bpm);
    } catch { /* no bpm — fine */ }
  }

  startPulse(bpm) {
    this.bpm = bpm;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!document.hidden) pulseOnce(0.35);
    }, 60000 / bpm);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.bpm = 0;
  }
}

// ---------- speed reactivity ----------

// Blob drift speed + gauge glow scale gently with driving speed.
export function applySpeedReactivity(kmh, enabled) {
  const f = enabled ? 1 + Math.min(kmh / 140, 1) * 1.6 : 1;
  root.style.setProperty('--blob-speed', f.toFixed(2));
}
