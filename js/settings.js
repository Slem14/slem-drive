// Settings model + glass bottom-sheet UI. Every change applies live and
// persists to localStorage.

const LS_KEY = 'slemdrive.settings.v1';
const LS_PRESETS = 'slemdrive.presets.v1';

export const BUILTIN_PRESETS = {
  ember:  { name: 'Ember',  accent: '#ff5e62', accent2: '#ffb347', blob1: '#7a1626', blob2: '#8a3b12', blob3: '#3c0f1e' },
  ice:    { name: 'Ice',    accent: '#8fd8ff', accent2: '#b18cff', blob1: '#1d5f8a', blob2: '#4b2e83', blob3: '#0e3a46' },
  mint:   { name: 'Mint',   accent: '#7df0c0', accent2: '#5ad7f0', blob1: '#0f5c42', blob2: '#114d5e', blob3: '#123b2e' },
  violet: { name: 'Violet', accent: '#c39bff', accent2: '#ff8fd2', blob1: '#3c1f73', blob2: '#6b1f5c', blob3: '#241244' },
  sunset: { name: 'Sunset', accent: '#ffb46b', accent2: '#ff6b8f', blob1: '#7a3a12', blob2: '#6e1430', blob3: '#3c1a0a' },
  mono:   { name: 'Mono',   accent: '#e8edf4', accent2: '#9aa6b8', blob1: '#2a2f3a', blob2: '#1a1e27', blob3: '#30343e' },
  oled:   { name: 'OLED',   accent: '#9ad0ff', accent2: '#7f9cff', blob1: '#05060a', blob2: '#05060a', blob3: '#05060a' },
};

export const DEFAULTS = {
  preset: 'ember',
  accent: '#ff5e62',
  accent2: '#ffb347',
  bgMode: 'album',            // album | theme | gradient | black
  blobIntensity: 1.15,        // 0..1.5
  blur: 28,                   // px
  glassOpacity: 1,            // 0.4..1.4
  grain: true,
  // per-element colors; null = auto (follow theme / defaults)
  colors: {
    arc1: null, arc2: null,   // gauge gradient ends
    speedNum: null,           // big speed number
    lyricsActive: null, lyricsInactive: null,
    npLyric: null,            // one-line lyric in the bar
    blob1: null, blob2: null, blob3: null,
    limitRing: null,          // limit sign ring
    roadName: null,
    glow: 1,                  // glow intensity 0..2
    albumAccents: true,       // album cover may recolor the accents
  },
  gauge: { style: 'arc', weight: 200, thickness: 14, ticks: true, unit: 'kmh', showRoad: true },
  limit: { size: 'm', pos: 'below', showUnknown: true },
  lyrics: { size: 'm', align: 'center', weight: 700, blur: 1, glow: true, offset: 0, showInTacho: true },
  react: { palette: true, pulse: true, mic: false, micSens: 1, bpm: false, speed: true },
  warn: { tolerance: 5, sound: false, soundStyle: 'chime', vignette: true },
  layout: { defaultView: 'tacho', swipe: true, barCompact: false, nightDim: 'off' }, // off | auto | on
};

const LYR_SIZES = { s: '1.35rem', m: '1.7rem', l: '2.05rem', xl: '2.5rem' };

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]))
      ? deepMerge(base[k] || {}, over[k])
      : over[k];
  }
  return out;
}

export class Settings {
  constructor() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { /* fresh */ }
    this.data = deepMerge(DEFAULTS, stored);
    this.listeners = [];
  }

  get(path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(path, value) {
    const keys = path.split('.');
    let o = this.data;
    for (const k of keys.slice(0, -1)) o = o[k];
    o[keys[keys.length - 1]] = value;
    this.save();
    for (const fn of this.listeners) fn(path, value);
  }

  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* full */ }
  }

  onChange(fn) { this.listeners.push(fn); }

  // ---------- presets ----------

  userPresets() {
    try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || {}; } catch { return {}; }
  }
  saveUserPresets(p) { localStorage.setItem(LS_PRESETS, JSON.stringify(p)); }

  allPresets() {
    return { ...BUILTIN_PRESETS, ...this.userPresets() };
  }

  applyPreset(id) {
    const p = this.allPresets()[id];
    if (!p) return;
    this.data.preset = id;
    this.data.accent = p.accent;
    this.data.accent2 = p.accent2;
    if (p.settings) this.data = deepMerge(this.data, p.settings);
    this.save();
    for (const fn of this.listeners) fn('preset', id);
  }

  saveCurrentAsPreset(name) {
    const presets = this.userPresets();
    const id = 'user-' + Date.now();
    presets[id] = {
      name,
      accent: this.data.accent,
      accent2: this.data.accent2,
      blob1: getComputedStyle(document.documentElement).getPropertyValue('--blob1').trim(),
      blob2: getComputedStyle(document.documentElement).getPropertyValue('--blob2').trim(),
      blob3: getComputedStyle(document.documentElement).getPropertyValue('--blob3').trim(),
      settings: JSON.parse(JSON.stringify(this.data)),
    };
    this.saveUserPresets(presets);
    return id;
  }

  deletePreset(id) {
    const presets = this.userPresets();
    delete presets[id];
    this.saveUserPresets(presets);
  }

  exportJSON() {
    return JSON.stringify({ settings: this.data, presets: this.userPresets() }, null, 2);
  }

  importJSON(text) {
    const parsed = JSON.parse(text); // throws on invalid input — caller handles
    if (parsed.settings) {
      this.data = deepMerge(DEFAULTS, parsed.settings);
      this.save();
    }
    if (parsed.presets) {
      this.saveUserPresets({ ...this.userPresets(), ...parsed.presets });
    }
    for (const fn of this.listeners) fn('*', null);
  }

  // ---------- apply to DOM (CSS vars + body classes) ----------

  applyAll() {
    const r = document.documentElement.style;
    const d = this.data;
    const preset = this.allPresets()[d.preset] || BUILTIN_PRESETS.ice;

    r.setProperty('--accent', d.accent);
    r.setProperty('--accent2', d.accent2);
    if (d.bgMode !== 'album') {
      r.setProperty('--blob1', d.bgMode === 'black' ? '#05060a' : (preset.blob1 || '#1d5f8a'));
      r.setProperty('--blob2', d.bgMode === 'black' ? '#05060a' : (preset.blob2 || '#4b2e83'));
      r.setProperty('--blob3', d.bgMode === 'black' ? '#05060a' : (preset.blob3 || '#0e3a46'));
    }
    r.setProperty('--blob-intensity', d.bgMode === 'black' ? 0 : (d.bgMode === 'gradient' ? d.blobIntensity * 0.7 : d.blobIntensity));
    r.setProperty('--blur', d.blur + 'px');
    r.setProperty('--glass-alpha', d.glassOpacity);
    r.setProperty('--grain-opacity', d.grain ? 0.05 : 0);
    r.setProperty('--speed-weight', d.gauge.weight);
    r.setProperty('--gauge-thickness', d.gauge.thickness);
    // per-element custom colors (null -> remove so the CSS fallback applies)
    const c = d.colors;
    const customVars = {
      arc1: c.arc1, arc2: c.arc2, 'speed-color': c.speedNum,
      'lyr-active': c.lyricsActive, 'lyr-inactive': c.lyricsInactive,
      'npline-color': c.npLyric, 'limit-ring': c.limitRing, 'road-color': c.roadName,
    };
    for (const [k, v] of Object.entries(customVars)) {
      if (v) r.setProperty('--' + k, v);
      else r.removeProperty('--' + k);
    }
    // custom blobs win over theme/album (except pure black background)
    if (d.bgMode !== 'black') {
      for (const k of ['blob1', 'blob2', 'blob3']) {
        if (c[k]) r.setProperty('--' + k, c[k]);
      }
    }
    r.setProperty('--glow', c.glow);

    r.setProperty('--lyr-size', LYR_SIZES[d.lyrics.size] || LYR_SIZES.m);
    r.setProperty('--lyr-weight', d.lyrics.weight);
    r.setProperty('--lyr-blur', d.lyrics.blur);
    r.setProperty('--lyr-align', d.lyrics.align);

    const b = document.body;
    b.dataset.gauge = d.gauge.style;
    b.dataset.limitSize = d.limit.size;
    b.dataset.limitPos = d.limit.pos;
    b.classList.toggle('hide-road', !d.gauge.showRoad);
    b.classList.toggle('lyr-glow', d.lyrics.glow);
    b.classList.toggle('hide-npline', !d.lyrics.showInTacho);
    b.classList.toggle('np-compact', d.layout.barCompact);

    this.applyNightDim();
  }

  applyNightDim() {
    const mode = this.data.layout.nightDim;
    let dim = 1;
    if (mode === 'on') dim = 0.72;
    else if (mode === 'auto') {
      const h = new Date().getHours();
      if (h >= 19 || h < 7) dim = 0.72; // rough sunset heuristic
    }
    document.documentElement.style.setProperty('--night-dim', dim);
  }
}

/* ============================================================
   Settings sheet UI
   ctx = { settings, spotify, redirectUri, toast,
           onDemoToggle(bool), isDemo(), onReactChange() }
   ============================================================ */

const SWATCHES = ['#8fd8ff', '#7df0c0', '#c39bff', '#ffb46b', '#ff6b8f', '#e8edf4', '#ffd84b', '#6bff9e'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function row(label) {
  const r = el('div', 'set-row');
  r.appendChild(el('span', null, label));
  return r;
}

function toggleRow(label, value, onSet) {
  const r = row(label);
  const t = el('button', 'toggle' + (value ? ' on' : ''));
  t.setAttribute('role', 'switch');
  t.setAttribute('aria-checked', value);
  t.addEventListener('click', () => {
    const on = !t.classList.contains('on');
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', on);
    onSet(on);
  });
  r.appendChild(t);
  return r;
}

function selectRow(label, options, value, onSet) {
  const r = row(label);
  const s = document.createElement('select');
  for (const [v, txt] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = txt;
    if (String(v) === String(value)) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onSet(s.value));
  r.appendChild(s);
  return r;
}

function sliderRow(label, min, max, step, value, onSet) {
  const r = row(label);
  const s = document.createElement('input');
  s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
  s.addEventListener('input', () => onSet(parseFloat(s.value)));
  r.appendChild(s);
  return r;
}

// Color picker + "Auto" reset. value null = auto (theme decides).
function colorRow(label, value, onSet) {
  const r = row(label);
  const wrap = el('div', 'colorpick');
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = value || '#ffffff';
  picker.classList.toggle('is-auto', !value);
  picker.addEventListener('input', () => {
    picker.classList.remove('is-auto');
    auto.classList.remove('sel');
    onSet(picker.value);
  });
  const auto = el('button', 'set-btn mini' + (value ? '' : ' sel'), 'Auto');
  auto.addEventListener('click', () => {
    picker.classList.add('is-auto');
    auto.classList.add('sel');
    onSet(null);
  });
  wrap.appendChild(picker);
  wrap.appendChild(auto);
  r.appendChild(wrap);
  return r;
}

// Random but harmonious theme: one hue, a shifted partner, dark blobs.
function randomTheme() {
  const h = Math.floor(Math.random() * 360);
  const h2 = (h + 35 + Math.floor(Math.random() * 60)) % 360;
  const h3 = (h + 180 + Math.floor(Math.random() * 40) - 20) % 360;
  const hsl = (hh, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + hh / 30) % 12;
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  };
  return {
    accent: hsl(h, 0.95, 0.66),
    accent2: hsl(h2, 0.9, 0.68),
    blob1: hsl(h, 0.7, 0.22),
    blob2: hsl(h2, 0.65, 0.18),
    blob3: hsl(h3, 0.6, 0.14),
  };
}

function buttonRow(label, btnText, onClick, cls = '') {
  const r = row(label);
  const b = el('button', 'set-btn ' + cls, btnText);
  b.addEventListener('click', onClick);
  r.appendChild(b);
  return r;
}

function group(title, ...children) {
  const g = el('div', 'set-group');
  g.appendChild(el('h3', null, title));
  const rows = el('div', 'set-rows');
  for (const c of children) if (c) rows.appendChild(c);
  g.appendChild(rows);
  return g;
}

export function buildSettingsSheet(container, ctx) {
  const { settings: st, spotify, toast } = ctx;
  const S = (path, v) => { st.set(path, v); st.applyAll(); };
  container.textContent = '';

  // ----- Themes / presets -----
  const presetsGroup = el('div', 'set-group');
  presetsGroup.appendChild(el('h3', null, 'Themes'));
  const strip = el('div', 'preset-strip');
  const presets = st.allPresets();
  for (const [id, p] of Object.entries(presets)) {
    const chip = el('button', 'preset-chip' + (st.get('preset') === id ? ' sel' : ''));
    const dots = el('div', 'preset-dots');
    for (const c of [p.accent, p.accent2, p.blob1 || '#333']) {
      const dot = el('i'); dot.style.background = c; dots.appendChild(dot);
    }
    chip.appendChild(dots);
    chip.appendChild(el('span', null, p.name));
    chip.addEventListener('click', () => {
      st.applyPreset(id);
      st.applyAll();
      buildSettingsSheet(container, ctx);
    });
    if (id.startsWith('user-')) {
      chip.addEventListener('contextmenu', (e) => e.preventDefault());
      let pressTimer;
      chip.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
          if (confirm(`Preset „${p.name}" löschen?`)) {
            st.deletePreset(id);
            buildSettingsSheet(container, ctx);
          }
        }, 650);
      }, { passive: true });
      chip.addEventListener('touchend', () => clearTimeout(pressTimer));
    }
    strip.appendChild(chip);
  }
  presetsGroup.appendChild(strip);

  const presetRows = el('div', 'set-rows');
  presetRows.appendChild(buttonRow('Aktuelles als Preset speichern', 'Speichern', () => {
    const name = prompt('Name für das Preset:');
    if (name) { st.saveCurrentAsPreset(name); buildSettingsSheet(container, ctx); toast('Preset gespeichert'); }
  }));
  const ioRow = buttonRow('Presets & Einstellungen', 'Export / Import', () => {
    jsonArea.hidden = !jsonArea.hidden;
    if (!jsonArea.hidden) jsonArea.value = st.exportJSON();
  });
  presetRows.appendChild(ioRow);
  presetsGroup.appendChild(presetRows);
  const jsonArea = document.createElement('textarea');
  jsonArea.className = 'set-json';
  jsonArea.hidden = true;
  presetsGroup.appendChild(jsonArea);
  const importBtn = el('button', 'set-btn accent', 'Eingefügten Text importieren');
  importBtn.style.marginTop = '8px';
  importBtn.addEventListener('click', () => {
    try {
      st.importJSON(jsonArea.value);
      st.applyAll();
      buildSettingsSheet(container, ctx);
      toast('Import erfolgreich ✓');
    } catch { toast('Ungültiges JSON'); }
  });
  presetsGroup.appendChild(importBtn);
  container.appendChild(presetsGroup);

  // ----- Colors -----
  const accentRow = row('Akzentfarbe');
  const sw = el('div', 'swatches');
  for (const c of SWATCHES) {
    const b = el('button', 'swatch' + (st.get('accent') === c ? ' sel' : ''));
    b.style.background = c;
    b.addEventListener('click', () => { S('accent', c); buildSettingsSheet(container, ctx); });
    sw.appendChild(b);
  }
  const picker = document.createElement('input');
  picker.type = 'color'; picker.value = st.get('accent');
  picker.addEventListener('input', () => S('accent', picker.value));
  sw.appendChild(picker);
  accentRow.appendChild(sw);

  const accent2Row = row('Zweite Akzentfarbe');
  const picker2 = document.createElement('input');
  picker2.type = 'color'; picker2.value = st.get('accent2');
  picker2.addEventListener('input', () => S('accent2', picker2.value));
  accent2Row.appendChild(picker2);

  const diceRow = buttonRow('Zufallstheme', '🎲 Würfeln', () => {
    const t = randomTheme();
    st.set('accent', t.accent);
    st.set('accent2', t.accent2);
    st.set('colors.blob1', t.blob1);
    st.set('colors.blob2', t.blob2);
    st.set('colors.blob3', t.blob3);
    st.applyAll();
    buildSettingsSheet(container, ctx);
  });

  container.appendChild(group('Farben',
    accentRow,
    accent2Row,
    diceRow,
    selectRow('Hintergrund', [
      ['album', 'Album-Cover'], ['theme', 'Theme-Farben'],
      ['gradient', 'Statischer Verlauf'], ['black', 'Pures Schwarz'],
    ], st.get('bgMode'), (v) => { S('bgMode', v); ctx.onReactChange(); }),
    sliderRow('Blob-Intensität', 0, 1.5, 0.05, st.get('blobIntensity'), (v) => S('blobIntensity', v)),
    sliderRow('Blur-Stärke', 6, 40, 1, st.get('blur'), (v) => S('blur', v)),
    sliderRow('Glas-Deckkraft', 0.4, 1.4, 0.05, st.get('glassOpacity'), (v) => S('glassOpacity', v)),
    toggleRow('Filmkorn', st.get('grain'), (v) => S('grain', v)),
  ));

  // ----- Advanced per-element colors -----
  const C = (key) => (v) => { S('colors.' + key, v); ctx.onReactChange(); };
  const adv = group('Erweiterte Farben',
    toggleRow('Album darf Akzente umfärben', st.get('colors.albumAccents'), C('albumAccents')),
    sliderRow('Glow-Stärke', 0, 2, 0.1, st.get('colors.glow'), (v) => S('colors.glow', v)),
    colorRow('Gauge-Verlauf Anfang', st.get('colors.arc1'), C('arc1')),
    colorRow('Gauge-Verlauf Ende', st.get('colors.arc2'), C('arc2')),
    colorRow('Tacho-Zahl', st.get('colors.speedNum'), C('speedNum')),
    colorRow('Hintergrund-Blob 1', st.get('colors.blob1'), C('blob1')),
    colorRow('Hintergrund-Blob 2', st.get('colors.blob2'), C('blob2')),
    colorRow('Hintergrund-Blob 3', st.get('colors.blob3'), C('blob3')),
    colorRow('Lyrics aktive Zeile', st.get('colors.lyricsActive'), C('lyricsActive')),
    colorRow('Lyrics inaktive Zeilen', st.get('colors.lyricsInactive'), C('lyricsInactive')),
    colorRow('Lyric-Zeile in der Leiste', st.get('colors.npLyric'), C('npLyric')),
    colorRow('Schild-Ring', st.get('colors.limitRing'), C('limitRing')),
    colorRow('Straßenname', st.get('colors.roadName'), C('roadName')),
  );
  adv.appendChild(el('p', 'set-note',
    '„Auto" = Farbe folgt dem Theme bzw. dem Album-Cover. Eigene Blob-Farben werden nie vom Cover überschrieben.'));
  container.appendChild(adv);

  // ----- Speedometer -----
  container.appendChild(group('Tacho',
    selectRow('Stil', [['arc', 'Bogen-Gauge'], ['digital', 'Nur digital'], ['minimal', 'Minimaler Ring']],
      st.get('gauge.style'), (v) => S('gauge.style', v)),
    selectRow('Zahlen-Gewicht', [[100, 'Ultraleicht'], [200, 'Dünn'], [300, 'Leicht'], [500, 'Mittel']],
      st.get('gauge.weight'), (v) => S('gauge.weight', parseInt(v, 10))),
    sliderRow('Gauge-Dicke', 6, 24, 1, st.get('gauge.thickness'), (v) => { S('gauge.thickness', v); ctx.onGaugeRedraw?.(); }),
    toggleRow('Skalenstriche', st.get('gauge.ticks'), (v) => { S('gauge.ticks', v); ctx.onGaugeRedraw?.(); }),
    selectRow('Einheit', [['kmh', 'km/h'], ['mph', 'mph']], st.get('gauge.unit'), (v) => S('gauge.unit', v)),
    toggleRow('Straßenname anzeigen', st.get('gauge.showRoad'), (v) => S('gauge.showRoad', v)),
  ));

  // ----- Limit sign -----
  container.appendChild(group('Tempolimit-Schild',
    selectRow('Größe', [['s', 'Klein'], ['m', 'Mittel'], ['l', 'Groß']], st.get('limit.size'), (v) => S('limit.size', v)),
    selectRow('Position', [['below', 'Unter dem Tacho'], ['corner', 'Ecke']], st.get('limit.pos'), (v) => S('limit.pos', v)),
    toggleRow('„Unbekannt" anzeigen', st.get('limit.showUnknown'), (v) => S('limit.showUnknown', v)),
  ));

  // ----- Lyrics -----
  container.appendChild(group('Lyrics',
    selectRow('Größe', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']], st.get('lyrics.size'), (v) => S('lyrics.size', v)),
    selectRow('Ausrichtung', [['center', 'Zentriert'], ['left', 'Links']], st.get('lyrics.align'), (v) => S('lyrics.align', v)),
    selectRow('Schriftgewicht', [[500, 'Mittel'], [600, 'Halbfett'], [700, 'Fett'], [800, 'Extrafett']],
      st.get('lyrics.weight'), (v) => S('lyrics.weight', parseInt(v, 10))),
    sliderRow('Unschärfe inaktiver Zeilen', 0, 2, 0.1, st.get('lyrics.blur'), (v) => S('lyrics.blur', v)),
    toggleRow('Glow', st.get('lyrics.glow'), (v) => S('lyrics.glow', v)),
    sliderRow('Offset (Sekunden)', -2, 2, 0.1, st.get('lyrics.offset'), (v) => S('lyrics.offset', v)),
    toggleRow('Lyric-Zeile im Tacho', st.get('lyrics.showInTacho'), (v) => S('lyrics.showInTacho', v)),
  ));

  // ----- Reactivity -----
  container.appendChild(group('Musik-Reaktivität',
    toggleRow('Album-Farbpalette', st.get('react.palette'), (v) => { S('react.palette', v); ctx.onReactChange(); }),
    toggleRow('Lyric-Puls', st.get('react.pulse'), (v) => S('react.pulse', v)),
    toggleRow('Mikrofon-Beat-Modus', st.get('react.mic'), (v) => { S('react.mic', v); ctx.onReactChange(); }),
    sliderRow('Mikrofon-Empfindlichkeit', 0.4, 2, 0.1, st.get('react.micSens'), (v) => { S('react.micSens', v); ctx.onReactChange(); }),
    toggleRow('BPM-Puls', st.get('react.bpm'), (v) => { S('react.bpm', v); ctx.onReactChange(); }),
    toggleRow('Geschwindigkeits-Reaktivität', st.get('react.speed'), (v) => S('react.speed', v)),
  ));
  const micNote = el('p', 'set-note',
    'Der Mikrofon-Modus hört auf die Musik im Auto und lässt die Farben im Takt pulsieren. Alles wird nur lokal verarbeitet — es wird nichts aufgenommen oder gesendet.');
  container.lastChild.appendChild(micNote);

  // ----- Warning -----
  container.appendChild(group('Tempowarnung',
    sliderRow('Toleranz (km/h)', 0, 15, 1, st.get('warn.tolerance'), (v) => S('warn.tolerance', v)),
    toggleRow('Roter Rand', st.get('warn.vignette'), (v) => S('warn.vignette', v)),
    toggleRow('Warnton', st.get('warn.sound'), (v) => S('warn.sound', v)),
    selectRow('Ton', [['chime', 'Sanfter Klang'], ['beep', 'Kurzer Piep'], ['voice', 'Stimme „Tempolimit"']],
      st.get('warn.soundStyle'), (v) => S('warn.soundStyle', v)),
  ));

  // ----- Layout -----
  container.appendChild(group('Layout',
    selectRow('Start-Ansicht', [['tacho', 'Tacho'], ['lyrics', 'Lyrics']],
      st.get('layout.defaultView'), (v) => S('layout.defaultView', v)),
    toggleRow('Wischen zum Wechseln', st.get('layout.swipe'), (v) => S('layout.swipe', v)),
    toggleRow('Kompakte Musikleiste', st.get('layout.barCompact'), (v) => S('layout.barCompact', v)),
    selectRow('Nacht-Dimmung', [['off', 'Aus'], ['auto', 'Automatisch'], ['on', 'An']],
      st.get('layout.nightDim'), (v) => S('layout.nightDim', v)),
  ));

  // ----- Spotify -----
  const statusRow = row('Status');
  statusRow.appendChild(el('span', null, spotify.connected ? 'Verbunden ✓' : 'Nicht verbunden'));

  const idRow = row('Client-ID');
  const idInput = document.createElement('input');
  idInput.type = 'text'; idInput.placeholder = 'aus dem Spotify-Dashboard';
  idInput.value = spotify.clientId;
  idInput.addEventListener('change', () => { spotify.clientId = idInput.value; });
  idRow.appendChild(idInput);

  const uriRow = buttonRow('Redirect-URI', 'Kopieren', async () => {
    try { await navigator.clipboard.writeText(ctx.redirectUri); toast('Kopiert: ' + ctx.redirectUri); }
    catch { prompt('Redirect-URI (manuell kopieren):', ctx.redirectUri); }
  });

  const connRow = buttonRow(
    spotify.connected ? 'Verbindung trennen' : 'Mit Spotify verbinden',
    spotify.connected ? 'Trennen' : 'Verbinden',
    () => {
      if (spotify.connected) { spotify.disconnect(); buildSettingsSheet(container, ctx); }
      else spotify.login();
    },
    spotify.connected ? 'danger' : 'accent',
  );

  const stuckRow = row('Login hängt? Code einfügen');
  const stuckInput = document.createElement('input');
  stuckInput.type = 'text'; stuckInput.placeholder = '?code=…';
  stuckInput.addEventListener('change', async () => {
    const raw = stuckInput.value.trim();
    const code = raw.includes('code=') ? new URLSearchParams(raw.split('?').pop()).get('code') : raw;
    if (code && await spotify.exchangePastedCode(code)) {
      buildSettingsSheet(container, ctx);
      spotify.startPolling();
    }
  });
  stuckRow.appendChild(stuckInput);

  const spGroup = group('Spotify', statusRow, idRow, uriRow, connRow, stuckRow);
  spGroup.appendChild(el('p', 'set-note',
    'Einrichtung: Auf developer.spotify.com eine App anlegen, die Redirect-URI oben eintragen und das eigene Spotify-Konto unter „User Management" hinzufügen. Für die Wiedergabesteuerung wird Spotify Premium benötigt.'));
  container.appendChild(spGroup);

  // ----- Test -----
  container.appendChild(group('Test',
    toggleRow('Demo-Modus', ctx.isDemo(), (v) => ctx.onDemoToggle(v)),
  ));

  // ----- About -----
  const about = el('div', 'set-group');
  about.appendChild(el('h3', null, 'Info'));
  about.appendChild(el('p', 'set-note',
    'Tempolimits: © OpenStreetMap-Mitwirkende (Overpass API). Lyrics: LRCLIB. ' +
    'Wichtig: Schilder an der Straße haben immer Vorrang — Baustellen, temporäre Limits und elektronische Anzeigen fehlen in den Kartendaten. ' +
    'GPS zeigt die echte Geschwindigkeit; der Auto-Tacho geht meist ein paar km/h vor.'));
  container.appendChild(about);
}
