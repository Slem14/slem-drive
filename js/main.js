// Slem Drive — boot, view switching, render loop, and wiring between
// geo / limits / spotify / lyrics / color / settings / demo.

import { GeoService, smoothSpeedStep } from './geo.js';
import { LimitService } from './limits.js';
import { SpotifyService, redirectUri } from './spotify.js';
import { fetchLyrics, parseLRC, activeLineIndex } from './lyrics.js';
import {
  applyAlbumPalette, pulseOnce, setPulse, MicBeat, BpmPulse, applySpeedReactivity,
} from './color.js';
import { Settings, buildSettingsSheet } from './settings.js';
import { DemoMode, DEMO_LRC } from './demo.js';
import {
  WeatherService, conditionEmoji, relativeWindAngle, windSideLabel, compassLabel,
  currentIsDay, crosswindKmh,
} from './weather.js';
import { WeatherFX } from './wx-fx.js';

const $ = (id) => document.getElementById(id);

// ---------- state ----------

const settings = new Settings();
const geo = new GeoService();
const limits = new LimitService();
const spotify = new SpotifyService();
const micBeat = new MicBeat();
const bpmPulse = new BpmPulse();
const weather = new WeatherService();
const weatherFX = new WeatherFX(document.getElementById('wx-canvas'));

const state = {
  started: false,
  demo: null,
  view: settings.get('layout.defaultView'),
  displayKmh: 0,
  targetKmh: 0,
  limit: { state: 'unknown', kmh: undefined, roadName: '' },
  playback: null,          // {isPlaying, progressMs, fetchedAt, durationMs}
  track: null,
  lyrics: null,            // {synced:[], plain} | null
  activeLine: -2,
  gaugeMax: 120,
  overspeed: false,
  overspeedSoundArmed: true,
  wakeLock: null,
  heading: null,
  wx: null,              // latest weather data (live or demo)
  gpsShown: null,        // GPS quality currently on screen
  gpsPending: null,      // candidate quality waiting out the debounce
  gpsPendingSince: 0,
};

// ---------- toast ----------

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- gauge ----------

const GAUGE_START = 225; // degrees from 12 o'clock, 0 km/h sits lower-left; 270° sweep clockwise
const GAUGE_SWEEP = 270;
const GAUGE_R = 120;
const CX = 150, CY = 150;

function polar(angleDeg, r = GAUGE_R) {
  const a = (angleDeg - 90) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arcPath(fromDeg, toDeg) {
  const [x1, y1] = polar(fromDeg);
  const [x2, y2] = polar(toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${GAUGE_R} ${GAUGE_R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function drawGaugeStatic() {
  const thickness = settings.get('gauge.thickness');
  const track = $('arc-track');
  const value = $('arc-value');
  track.setAttribute('d', arcPath(GAUGE_START, GAUGE_START + GAUGE_SWEEP));
  track.setAttribute('stroke-width', thickness);
  value.setAttribute('stroke-width', thickness);

  // ticks + labels
  const g = $('gauge-ticks');
  g.textContent = '';
  if (!settings.get('gauge.ticks')) return;
  const max = state.gaugeMax;
  const step = max <= 120 ? 20 : max <= 180 ? 30 : 40;
  const ns = 'http://www.w3.org/2000/svg';
  for (let v = 0; v <= max; v += step / 2) {
    const major = v % step === 0;
    const ang = GAUGE_START + GAUGE_SWEEP * (v / max);
    const [x1, y1] = polar(ang, GAUGE_R - (major ? 16 : 13));
    const [x2, y2] = polar(ang, GAUGE_R - 22);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    if (!major) line.setAttribute('opacity', '0.45');
    g.appendChild(line);
    if (major) {
      const [tx, ty] = polar(ang, GAUGE_R - 34);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', tx); text.setAttribute('y', ty + 4);
      text.textContent = Math.round(toUnit(v));
      g.appendChild(text);
    }
  }
}

const ARC_LEN = Math.PI * 2 * GAUGE_R * (GAUGE_SWEEP / 360);

function updateGauge(kmh) {
  const frac = Math.max(0, Math.min(1, kmh / state.gaugeMax));
  const value = $('arc-value');
  value.setAttribute('d', arcPath(GAUGE_START, GAUGE_START + GAUGE_SWEEP));
  value.setAttribute('stroke-dasharray', `${(frac * ARC_LEN).toFixed(1)} ${ARC_LEN.toFixed(1)}`);

  // limit dot on the arc
  const dot = $('arc-limit-dot');
  if (state.limit.state === 'limit' && state.limit.kmh <= state.gaugeMax) {
    const ang = GAUGE_START + GAUGE_SWEEP * (state.limit.kmh / state.gaugeMax);
    const [x, y] = polar(ang);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('opacity', '0.95');
  } else {
    dot.setAttribute('opacity', '0');
  }
}

// dynamic gauge scale with hysteresis (km/h domain)
function updateGaugeMax(kmh) {
  const limitKmh = state.limit.state === 'limit' ? state.limit.kmh : 0;
  const needed = Math.max(kmh, limitKmh) + 12;
  const steps = [120, 180, 220]; // top step fits the car's real ~203 km/h max
  let target = steps.find((s) => s >= needed) || steps[steps.length - 1];
  // step down only with margin, so the scale doesn't bounce
  if (target < state.gaugeMax && needed > target - 35) target = state.gaugeMax;
  if (target !== state.gaugeMax) {
    state.gaugeMax = target;
    drawGaugeStatic();
  }
}

// ---------- units ----------

function toUnit(kmh) {
  return settings.get('gauge.unit') === 'mph' ? kmh * 0.621371 : kmh;
}

// ---------- limit sign ----------

function renderLimit(lim) {
  state.limit = lim;
  const sign = $('limit-sign');
  const text = $('limit-text');
  sign.className = '';
  const showUnknown = settings.get('limit.showUnknown');

  switch (lim.state) {
    case 'limit':
      text.textContent = lim.kmh;
      break;
    case 'walk':
      text.textContent = '7';
      break;
    case 'none':
      sign.classList.add('limit-none');
      text.textContent = '';
      break;
    case 'variable':
      sign.classList.add('limit-variable');
      text.textContent = '?';
      break;
    default:
      sign.classList.add('limit-unknown');
      text.textContent = '–';
  }
  sign.style.visibility = (lim.state === 'unknown' && !showUnknown) ? 'hidden' : 'visible';
  $('road-name').textContent = lim.roadName || '';
  $('roadworks-badge').hidden = !lim.roadworks;

  sign.classList.remove('pop');
  void sign.offsetWidth; // restart animation
  sign.classList.add('pop');
}

// GPS loss: keep the last limit but dim it
function setLimitStale(stale) {
  $('limit-sign').style.opacity = stale ? 0.45 : 1;
}

// ---------- overspeed ----------

const audioCtx = { ctx: null };
function ensureAudio() {
  if (!audioCtx.ctx) {
    try { audioCtx.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* none */ }
  }
  return audioCtx.ctx;
}

function playWarnSound() {
  const style = settings.get('warn.soundStyle');
  if (style === 'voice' && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance('Tempolimit');
    u.lang = 'de-DE';
    speechSynthesis.speak(u);
    return;
  }
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  if (style === 'beep') {
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 880;
    osc.connect(gain);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.start(t); osc.stop(t + 0.2);
  } else { // soft chime: two sine notes
    for (const [freq, dt] of [[660, 0], [880, 0.16]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.1, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.5);
      osc.start(t + dt); osc.stop(t + dt + 0.55);
    }
  }
}

function checkOverspeed(kmh) {
  const lim = state.limit;
  const tol = settings.get('warn.tolerance');
  const over = lim.state === 'limit' && kmh > lim.kmh + tol;
  if (over !== state.overspeed) {
    state.overspeed = over;
    document.body.classList.toggle('overspeed', over);
    if (over && settings.get('warn.sound') && state.overspeedSoundArmed) {
      playWarnSound();
      state.overspeedSoundArmed = false;
    }
    if (!over) state.overspeedSoundArmed = true;
  }
  $('vignette').classList.toggle('enabled', settings.get('warn.vignette'));
}

// ---------- lyrics rendering ----------

function buildLyricsDOM() {
  const wrap = $('lyrics-lines');
  wrap.textContent = '';
  wrap.classList.remove('plain');
  wrap.style.transform = '';
  state.activeLine = -2;
  $('lyrics-empty').hidden = true;

  const ly = state.lyrics;
  if (!ly || (!ly.synced && !ly.plain)) {
    $('lyrics-empty').hidden = false;
    $('lyrics-empty-text').textContent = state.track
      ? 'Keine Lyrics gefunden' : 'Keine Wiedergabe';
    return;
  }

  if (ly.synced && ly.synced.length) {
    for (const line of ly.synced) {
      const div = document.createElement('div');
      div.className = 'lyr-line' + (line.text ? '' : ' gap');
      div.textContent = line.text || '• • •';
      wrap.appendChild(div);
    }
  } else {
    wrap.classList.add('plain');
    for (const line of ly.plain.split('\n')) {
      const div = document.createElement('div');
      div.className = 'lyr-line active';
      div.style.filter = 'none';
      div.textContent = line || ' ';
      wrap.appendChild(div);
    }
  }
}

function playbackPosSec() {
  const p = state.playback;
  if (!p) return 0;
  const extra = p.isPlaying ? (Date.now() - p.fetchedAt) : 0;
  return Math.min(p.progressMs + extra, p.durationMs || Infinity) / 1000;
}

let lastNpLine = '';
function syncLyrics() {
  const ly = state.lyrics;
  if (!ly || !ly.synced || !ly.synced.length || !state.playback) return;
  const t = playbackPosSec() + settings.get('lyrics.offset');
  const idx = activeLineIndex(ly.synced, t);
  if (idx === state.activeLine) return;
  state.activeLine = idx;

  const wrap = $('lyrics-lines');
  const lines = wrap.children;
  for (let i = 0; i < lines.length; i++) {
    lines[i].classList.toggle('active', i === idx);
    lines[i].style.setProperty('--d', Math.min(Math.abs(i - idx), 4));
  }

  // center the active line
  if (idx >= 0 && lines[idx]) {
    const scroller = $('lyrics-scroller');
    const line = lines[idx];
    const offset = scroller.clientHeight / 2 - (line.offsetTop + line.offsetHeight / 2);
    wrap.style.transform = `translateY(${offset.toFixed(1)}px)`;
  }

  // lyric pulse
  if (idx >= 0 && settings.get('react.pulse') && !settings.get('react.mic')) {
    pulseOnce(0.85);
  }

  // one-line lyric in the now-playing bar
  const npl = $('np-lyric-line');
  const text = idx >= 0 && ly.synced[idx].text ? ly.synced[idx].text : '';
  if (text !== lastNpLine) {
    lastNpLine = text;
    npl.classList.add('slide');
    requestAnimationFrame(() => {
      npl.textContent = text;
      npl.classList.remove('slide');
    });
  }
}

// ---------- track handling ----------

async function onTrack(track) {
  state.track = track;
  state.lyrics = null;
  lastNpLine = '';
  $('np-lyric-line').textContent = '';

  if (!track) {
    $('np-title').textContent = spotify.connected || state.demo ? 'Keine Wiedergabe' : 'Spotify verbinden';
    $('np-artist').textContent = spotify.connected || state.demo ? '' : 'Hier tippen für die Einrichtung →';
    $('np-cover').removeAttribute('src');
    buildLyricsDOM();
    bpmPulse.stop();
    return;
  }

  $('np-title').textContent = track.title;
  $('np-artist').textContent = track.artist;

  const cover = $('np-cover');
  if (track.cover) {
    cover.src = track.cover;
    if (settings.get('react.palette') && settings.get('bgMode') === 'album') {
      const apply = () => { applyAlbumPalette(cover, paletteLocks()); };
      if (cover.complete && cover.naturalWidth) apply();
      else cover.onload = apply;
    }
  } else {
    cover.removeAttribute('src');
  }

  if (settings.get('react.bpm')) bpmPulse.lookup(track.title, track.artist);

  // lyrics
  if (track.id === 'demo-track') {
    state.lyrics = { synced: parseLRC(DEMO_LRC), plain: null };
    buildLyricsDOM();
    return;
  }
  const wanted = track.id;
  const ly = await fetchLyrics({
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationMs / 1000,
  });
  if (state.track && state.track.id === wanted) { // still the same song
    state.lyrics = ly;
    buildLyricsDOM();
  }
}

function onPlayback(p) {
  state.playback = p;
  // see the #np-play rules in app.css for why this is a class, not `hidden`
  $('np-play').classList.toggle('playing', !!p.isPlaying);
}

// ---------- weather ----------

function renderWeather(wx) {
  state.wx = wx;
  const block = $('weather-block');
  const enabled = settings.get('weather.enabled');
  block.hidden = !enabled || !wx;

  const body = document.body;
  if (!enabled || !wx) {
    delete body.dataset.wx;
    delete body.dataset.daynight;
    weatherFX.stop();
    weatherFX.condition = null;
    return;
  }

  // background mood — day/night from the sun times for the current moment
  const isDay = state.demo ? wx.isDay : currentIsDay(wx);
  body.dataset.wx = wx.condition;
  body.dataset.daynight = isDay ? 'day' : 'night';
  if (settings.get('weather.effects')) {
    weatherFX.setWind(relativeWindAngle(wx.windFromDeg, state.heading ?? 0), wx.windKmh);
    weatherFX.set(wx.condition, isDay);
  } else {
    weatherFX.stop();
    weatherFX.condition = null;
  }

  // temperature chip ("in-car" temp isn't readable on iPhones; feels-like instead)
  $('wx-icon').textContent = conditionEmoji(wx.condition, isDay);
  $('wx-temp').textContent = `${wx.tempC}°`;
  $('wx-feels').textContent = wx.feelsC !== wx.tempC ? `gefühlt ${wx.feelsC}°` : '';

  $('wind-kmh').textContent = wx.windKmh;
  updateWindRose();
}

// Rotate the wind arrow to where the wind comes from, relative to the
// car nose (which always points up in the rose).
function updateWindRose() {
  const wx = state.wx;
  const flow = $('wind-flow');
  if (!flow) return;
  if (!wx || wx.windFromDeg == null) { flow.setAttribute('opacity', '0'); return; }
  const rel = relativeWindAngle(wx.windFromDeg, state.heading ?? 0);
  flow.setAttribute('opacity', '1');
  flow.style.transform = `rotate(${rel}deg)`;
  // stronger wind streams faster: ~2.2 s when barely moving, ~0.45 s in a gale
  const dur = Math.max(0.45, 2.2 - (wx.windKmh || 0) / 45);
  flow.style.setProperty('--wind-dur', dur.toFixed(2) + 's');
  // relative side while driving, absolute compass direction while parked
  $('wind-side').textContent = state.heading != null
    ? windSideLabel(rel)
    : compassLabel(wx.windFromDeg);
  weatherFX.setWind(rel, wx.windKmh); // rain/snow lean with the crosswind
  updateWindWarning(rel);
}

// Warn on the sideways component — a headwind just slows you down, a
// crosswind is what actually pushes the car. Gusts matter more than the
// average, so warn on those. Parked (no heading): use the raw gust.
function updateWindWarning(rel) {
  const wx = state.wx;
  if (!wx) return;
  const gust = Math.max(wx.windKmh, wx.gustKmh || 0);
  const effective = rel != null ? crosswindKmh(gust, rel) : gust;
  $('wind-chip').classList.toggle('warn', effective >= settings.get('weather.warnKmh'));
}

// ---------- GPS wiring ----------

function onFix(fix) {
  state.targetKmh = fix.speedKmh;
  if (fix.heading != null) {
    state.heading = fix.heading;
    updateWindRose();
  }
  if (fix.demo) return; // demo feeds limits + weather directly
  limits.onFix(fix);
  if (settings.get('weather.enabled')) weather.maybeFetch(fix);
}

limits.onUpdate = (res) => renderLimit(res);

// ---------- render loop ----------

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !state.started) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.2);
  lastFrame = now;

  state.displayKmh = smoothSpeedStep(state.displayKmh, state.targetKmh, dt);

  const shown = Math.round(toUnit(state.displayKmh));
  const numEl = $('speed-num');
  if (numEl.textContent !== String(shown)) numEl.textContent = shown;

  updateGaugeMax(state.displayKmh);
  updateGauge(state.displayKmh);
  checkOverspeed(state.displayKmh);
  applySpeedReactivity(state.displayKmh, settings.get('react.speed'));

  // GPS quality dot. Raw accuracy jitters every fix, which made the dot
  // blink between colours — only commit a change once it has held for a
  // moment, so the dot reports a trend instead of flickering.
  const q = state.demo ? 'good' : geo.quality();
  if (q !== state.gpsPending) {
    state.gpsPending = q;
    state.gpsPendingSince = now;
  }
  if (q !== state.gpsShown && now - state.gpsPendingSince > 2500) {
    state.gpsShown = q;
    $('gps-dot').className = 'status-dot ' + q;
    if (!state.demo) setLimitStale(q === 'bad');
  }

  // progress bar
  if (state.playback && state.playback.durationMs) {
    const frac = Math.min(1, (playbackPosSec() * 1000) / state.playback.durationMs);
    $('np-progress-fill').style.width = (frac * 100).toFixed(2) + '%';
  }

  syncLyrics();
}

// ---------- views ----------

function switchView(view) {
  state.view = view;
  document.body.classList.toggle('view-lyrics', view === 'lyrics');
  for (const btn of document.querySelectorAll('.seg-btn')) {
    const active = btn.dataset.view === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  }
  $('view-tacho').classList.toggle('active', view === 'tacho');
  $('view-lyrics').classList.toggle('active', view === 'lyrics');
}

function setupViews() {
  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  }
  // swipe
  let x0 = null, y0 = null;
  const views = $('views');
  views.addEventListener('touchstart', (e) => {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  views.addEventListener('touchend', (e) => {
    if (x0 == null || !settings.get('layout.swipe')) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      switchView(dx < 0 ? 'lyrics' : 'tacho');
    }
    x0 = null;
  }, { passive: true });
}

// ---------- long-press theme strip ----------

function setupThemeStrip() {
  const strip = $('theme-strip');
  let timer = null;

  const show = () => {
    strip.textContent = '';
    for (const [id, p] of Object.entries(settings.allPresets())) {
      const chip = document.createElement('button');
      chip.className = 'preset-chip' + (settings.get('preset') === id ? ' sel' : '');
      const dots = document.createElement('div');
      dots.className = 'preset-dots';
      for (const c of [p.accent, p.accent2]) {
        const i = document.createElement('i'); i.style.background = c; dots.appendChild(i);
      }
      chip.appendChild(dots);
      const span = document.createElement('span'); span.textContent = p.name;
      chip.appendChild(span);
      chip.addEventListener('click', () => {
        settings.applyPreset(id);
        settings.applyAll();
        show(); // refresh selection
      });
      strip.appendChild(chip);
    }
    strip.hidden = false;
    setTimeout(() => strip.classList.add('show'), 20);
  };
  const hide = () => {
    strip.classList.remove('show');
    setTimeout(() => { strip.hidden = true; }, 300);
  };

  const views = $('views');
  views.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    timer = setTimeout(show, 600);
  }, { passive: true });
  for (const ev of ['touchend', 'touchmove', 'touchcancel']) {
    views.addEventListener(ev, () => clearTimeout(timer), { passive: true });
  }
  // desktop: long mouse press
  views.addEventListener('mousedown', () => { timer = setTimeout(show, 600); });
  views.addEventListener('mouseup', () => clearTimeout(timer));

  document.addEventListener('click', (e) => {
    if (!strip.hidden && !strip.contains(e.target)) hide();
  });
}

// ---------- settings sheet ----------

function sheetCtx() {
  return {
    settings,
    spotify,
    toast,
    redirectUri: redirectUri(),
    isDemo: () => !!state.demo,
    onDemoToggle: (on) => (on ? startDemo() : stopDemo()),
    onGaugeRedraw: () => drawGaugeStatic(),
    onReactChange: () => applyReactivity(),
    onWeatherChange: () => renderWeather(state.wx),
  };
}

function openSheet() {
  buildSettingsSheet($('sheet-content'), sheetCtx());
  $('sheet-backdrop').hidden = false;
  $('settings-sheet').hidden = false;
  // setTimeout, not rAF: rAF can be suspended in occluded tabs
  setTimeout(() => {
    $('sheet-backdrop').classList.add('show');
    $('settings-sheet').classList.add('show');
  }, 20);
}

function closeSheet() {
  $('sheet-backdrop').classList.remove('show');
  $('settings-sheet').classList.remove('show');
  setTimeout(() => {
    $('sheet-backdrop').hidden = true;
    $('settings-sheet').hidden = true;
  }, 450);
}

function setupSheet() {
  $('btn-settings').addEventListener('click', openSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  // swipe down on handle closes
  let y0 = null;
  $('sheet-handle').addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  $('sheet-handle').addEventListener('touchend', (e) => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 30) closeSheet();
    y0 = null;
  }, { passive: true });
}

// User-pinned colors the album palette must not touch.
function paletteLocks() {
  const c = settings.get('colors');
  const noAccents = !c.albumAccents;
  return {
    accent: noAccents, accent2: noAccents,
    blob1: !!c.blob1, blob2: !!c.blob2, blob3: !!c.blob3,
  };
}

// ---------- reactivity modes ----------

async function applyReactivity() {
  settings.applyAll();
  // mic beat
  if (settings.get('react.mic')) {
    micBeat.sensitivity = settings.get('react.micSens');
    const ok = await micBeat.start();
    if (!ok) {
      toast('Mikrofon-Zugriff nicht möglich. Berechtigung prüfen.');
      settings.set('react.mic', false);
    }
  } else {
    micBeat.stop();
  }
  // bpm
  if (settings.get('react.bpm') && state.track) {
    bpmPulse.lookup(state.track.title, state.track.artist);
  } else if (!settings.get('react.bpm')) {
    bpmPulse.stop();
  }
  // re-apply album palette if switching back to album mode
  if (settings.get('bgMode') === 'album' && settings.get('react.palette')) {
    const cover = $('np-cover');
    if (cover.src && cover.complete && cover.naturalWidth) applyAlbumPalette(cover, paletteLocks());
  }
}

// ---------- demo ----------

function startDemo() {
  if (state.demo) return;
  spotify.stopPolling();
  state.demo = new DemoMode({
    onFix,
    onLimit: (lim) => renderLimit(lim),
    onTrack: (t) => onTrack(t),
    onPlayback: (p) => onPlayback(p),
    onWeather: (wx) => renderWeather(wx),
  });
  state.demo.start();
  toast('Demo-Modus aktiv');
}

function stopDemo() {
  if (!state.demo) return;
  state.demo.stop();
  state.demo = null;
  state.targetKmh = 0;
  renderLimit({ state: 'unknown', roadName: '' });
  renderWeather(weather.data); // back to real weather (or none)
  if (spotify.connected) spotify.startPolling();
}

// ---------- wake lock ----------

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    if (!requestWakeLock.warned) {
      requestWakeLock.warned = true;
      toast('Bildschirm-Wachhalten nicht unterstützt — in den iPhone-Einstellungen „Automatische Sperre" auf „Nie" stellen.');
    }
    return;
  }
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* e.g. low battery mode */ }
}

// ---------- start ----------

async function start(demo = false) {
  if (state.started) return;
  state.started = true;
  $('start-screen').classList.add('gone');
  $('app').hidden = false;

  ensureAudio(); // unlock audio on the user gesture
  await requestWakeLock();

  if (demo) {
    startDemo();
  } else {
    geo.start();
    if (spotify.connected) spotify.startPolling();
  }
  drawGaugeStatic();
}

// ---------- boot ----------

async function boot() {
  // Wire the start buttons FIRST. Everything below can touch storage, the
  // network or optional DOM, and if any of it throws the user must still be
  // able to start the app rather than face a dead "Losfahren" button.
  $('btn-start').addEventListener('click', () => start(false));
  $('btn-demo').addEventListener('click', () => start(true));

  // Register the service worker next, before anything else can throw: it is
  // what pulls in a newer build, so it has to run even if the rest of boot
  // fails. On activation the page reloads once onto the fresh files.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'sw-activated') return;
      const key = 'slemdrive.reloadedFor';
      try {
        if (sessionStorage.getItem(key) === e.data.version) return; // already did
        sessionStorage.setItem(key, e.data.version);
      } catch { return; } // no sessionStorage: skip rather than risk a loop
      if (!state.started) location.reload(); // never yank the screen mid-drive
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell unavailable */ });
  }

  settings.applyAll();
  settings.onChange(() => { /* applied by UI already */ });

  geo.onFix = onFix;
  geo.onError = (err) => {
    if (err.code === 1) toast('GPS-Berechtigung verweigert. In den Einstellungen erlauben.');
  };

  spotify.onToast = toast;
  spotify.onTrack = onTrack;
  spotify.onPlayback = onPlayback;

  weather.onUpdate = (wx) => { if (!state.demo) renderWeather(wx); };
  if (weather.data) renderWeather(weather.data); // cached from last session

  // Spotify redirect handling (incl. stranded-in-Safari case)
  const redirect = await spotify.handleRedirect();
  if (redirect && redirect.status === 'stranded') {
    // Safari got the code but the verifier lives in the home-screen app.
    prompt(
      'Login-Code kopieren und in der Slem-Drive-App unter Einstellungen → Spotify → „Login hängt?" einfügen:',
      redirect.code,
    );
  }

  // tapping the bar while not connected jumps straight to the Spotify setup
  $('np-meta').addEventListener('click', () => {
    if (spotify.connected || state.demo) return;
    openSheet();
    setTimeout(() => {
      document.getElementById('sp-group')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 500);
  });

  $('np-play').addEventListener('click', () => { if (!state.demo) spotify.togglePlay(); });
  $('np-next').addEventListener('click', () => { if (!state.demo) spotify.control('next'); });
  $('np-prev').addEventListener('click', () => { if (!state.demo) spotify.control('prev'); });

  setupViews();
  setupSheet();
  setupThemeStrip();
  switchView(settings.get('layout.defaultView'));

  // A2HS hint when running in plain Safari on iOS
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIOS && !standalone) $('a2hs-hint').hidden = false;

  // visibility: pause polling + re-acquire wake lock
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      spotify.stopPolling();
      setPulse(0);
    } else {
      if (state.started && !state.demo && spotify.connected) spotify.startPolling();
      if (state.started) requestWakeLock();
      lastFrame = performance.now();
    }
  });

  // night dim re-check every minute
  setInterval(() => settings.applyNightDim(), 60000);

  // OSM attribution lives in Einstellungen → Info (the data licence requires
  // credit, but it does not have to sit on the driving screen).

  applyReactivity();
  requestAnimationFrame(frame);
}

boot();
