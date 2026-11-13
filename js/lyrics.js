// Synced lyrics from LRCLIB. Pure parsing/cleaning helpers are exported
// for unit tests and kept DOM-free.

const API = 'https://lrclib.net/api';
const CACHE_KEY = 'slemdrive.lyrics.v1';
const CACHE_MAX = 50;

// ---------- LRC parsing ----------

// Parse LRC text into [{ time: seconds, text }], sorted by time.
// Multiple timestamps per line are supported. Empty-text lines are kept
// (instrumental gaps).
export function parseLRC(lrc) {
  if (!lrc) return [];
  const lines = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) {
      const min = parseInt(m[1], 10);
      const sec = parseFloat(m[2].replace(':', '.'));
      if (Number.isNaN(min) || Number.isNaN(sec)) continue;
      lines.push({ time: min * 60 + sec, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

// Index of the active line for playback position t (seconds), -1 before
// the first line. Binary search — called every frame.
export function activeLineIndex(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// ---------- title cleaning ----------

// Strip noise suffixes so LRCLIB search finds the base track.
export function cleanTitle(title) {
  if (!title) return '';
  let t = title;
  t = t.replace(/\s*[([][^)\]]*(remaster|remastered|deluxe|anniversary|edition|version|mix|live|feat\.|ft\.|with |bonus|mono|stereo|single|radio edit|extended|demo)[^)\]]*[)\]]/gi, '');
  t = t.replace(/\s*-\s*(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|live( .*)?|radio edit|single version|extended( .*)?|mono|stereo|deluxe.*|bonus track|demo|acoustic( .*)?|from .*)$/gi, '');
  t = t.replace(/\s*(feat\.|ft\.)\s.*$/gi, '');
  return t.replace(/\s{2,}/g, ' ').trim();
}

// ---------- fetch + cache ----------

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0));
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* full */ }
}

// No custom headers anywhere (avoids CORS preflight).
async function getJSON(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('lrclib ' + res.status);
  return res.json();
}

function pickResult(results, durationSec) {
  if (!Array.isArray(results)) return null;
  const synced = results.filter((r) => r.syncedLyrics &&
    (durationSec == null || Math.abs(r.duration - durationSec) <= 3));
  if (synced.length) return synced[0];
  const anySynced = results.find((r) => r.syncedLyrics);
  if (anySynced) return anySynced;
  return results.find((r) => r.plainLyrics) || null;
}

// Fetch lyrics for a track. Returns:
//   { synced: [{time,text}], plain: string|null } or null if nothing found.
export async function fetchLyrics({ title, artist, album, durationSec }) {
  const key = `${title}::${artist}`.toLowerCase();
  const cache = typeof localStorage !== 'undefined' ? loadCache() : {};
  if (cache[key]) {
    cache[key].at = Date.now();
    saveCache(cache);
    return cache[key].data;
  }

  let rec = null;
  try {
    const q = (p) => Object.entries(p)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

    rec = await getJSON(`${API}/get?${q({
      track_name: title, artist_name: artist, album_name: album,
      duration: durationSec ? Math.round(durationSec) : undefined,
    })}`);

    if (!rec) {
      const results = await getJSON(`${API}/search?${q({ track_name: title, artist_name: artist })}`);
      rec = pickResult(results, durationSec);
    }
    if (!rec) {
      const cleaned = cleanTitle(title);
      if (cleaned && cleaned !== title) {
        const results = await getJSON(`${API}/search?${q({ track_name: cleaned, artist_name: artist })}`);
        rec = pickResult(results, durationSec);
      }
    }
  } catch {
    return null; // network error: don't cache, retry next track change
  }

  const data = rec ? {
    synced: rec.syncedLyrics ? parseLRC(rec.syncedLyrics) : null,
    plain: rec.plainLyrics || null,
  } : null;

  if (typeof localStorage !== 'undefined') {
    cache[key] = { at: Date.now(), data };
    saveCache(cache);
  }
  return data;
}
