// Speed limits from OpenStreetMap via Overpass API.
// Pure logic (parsing, geometry, matching) is exported for unit tests
// and kept DOM-free so Node can import this module.

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const FETCH_RADIUS = 500;        // m
const REFETCH_DIST = 350;        // m from last fetch center
const MIN_FETCH_INTERVAL = 4000; // ms
const ERROR_BACKOFF = 15000;     // ms

const HIGHWAY_RE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$';

// ---------- maxspeed parsing ----------

// Returns { kind: 'limit'|'none'|'variable'|'walk'|'unknown', kmh?: number }
export function parseMaxspeedValue(raw) {
  if (raw == null || raw === '') return { kind: 'unknown' };
  const v = String(raw).trim().toLowerCase();

  // multiple values "50;30" -> take the lower
  if (v.includes(';')) {
    const parts = v.split(';').map((p) => parseMaxspeedValue(p));
    const limits = parts.filter((p) => p.kind === 'limit');
    if (limits.length) return limits.reduce((a, b) => (a.kmh <= b.kmh ? a : b));
    return parts.find((p) => p.kind !== 'unknown') || { kind: 'unknown' };
  }

  if (v === 'none' || v === 'de:motorway') return { kind: 'none' };
  if (v === 'signals' || v === 'variable') return { kind: 'variable' };
  if (v === 'walk' || v === 'de:living_street' || v === 'de:walk') return { kind: 'walk' };
  if (v === 'de:urban') return { kind: 'limit', kmh: 50 };
  if (v === 'de:rural') return { kind: 'limit', kmh: 100 };

  const zone = v.match(/^de:zone:?(\d+)$/);
  if (zone) return { kind: 'limit', kmh: parseInt(zone[1], 10) };

  const mph = v.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mph) return { kind: 'limit', kmh: Math.round(parseFloat(mph[1]) * 1.609344) };

  const knots = v.match(/^(\d+(?:\.\d+)?)\s*knots$/);
  if (knots) return { kind: 'limit', kmh: Math.round(parseFloat(knots[1]) * 1.852) };

  const num = v.match(/^(\d+(?:\.\d+)?)(?:\s*km\/h)?$/);
  if (num) return { kind: 'limit', kmh: Math.round(parseFloat(num[1])) };

  return { kind: 'unknown' };
}

// Resolve the effective limit for a way, given travel direction.
// forward = true when travelling in way-node order.
export function limitForWay(tags, forward = true) {
  const dir = forward ? tags['maxspeed:forward'] : tags['maxspeed:backward'];
  let r = parseMaxspeedValue(dir);
  if (r.kind !== 'unknown') return r;

  r = parseMaxspeedValue(tags.maxspeed);
  if (r.kind !== 'unknown') return r;

  // zone tag fallback when maxspeed is missing
  r = parseMaxspeedValue(tags['zone:maxspeed']);
  if (r.kind !== 'unknown') return r;

  // untagged motorway -> no limit; everything else -> unknown (never guess)
  if (tags.highway === 'motorway') return { kind: 'none' };
  if (tags.highway === 'living_street') return { kind: 'walk' };
  return { kind: 'unknown' };
}

// ---------- geometry (local-meter projection) ----------

const R_EARTH = 6371000;
const DEG = Math.PI / 180;

// Project lat/lon to local meters around a reference latitude.
export function toLocalMeters(lat, lon, refLat, refLon) {
  const x = (lon - refLon) * DEG * R_EARTH * Math.cos(refLat * DEG);
  const y = (lat - refLat) * DEG * R_EARTH;
  return [x, y];
}

// Distance from point p to segment a-b (all in local meters) and the
// projection parameter t (0..1) along the segment.
export function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

// Bearing of segment a->b in degrees 0..360 (0 = north).
export function segBearing(ax, ay, bx, by) {
  return (Math.atan2(bx - ax, by - ay) / DEG + 360) % 360;
}

// Smallest absolute angle difference in degrees (0..180).
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------- road matching ----------

// Find the best matching way for a GPS fix among cached ways.
// fix: { lat, lon, heading (deg or null), speedKmh, accuracy (m) }
// ways: [{ id, tags, geometry: [{lat, lon}, ...] }]
// Returns { way, dist, forward } or null.
export function matchRoad(fix, ways) {
  const maxDist = Math.min(40, Math.max(25, (fix.accuracy || 15) * 1.5));
  const useHeading = fix.heading != null && fix.speedKmh > 8;
  let best = null;

  for (const way of ways) {
    const g = way.geometry;
    if (!g || g.length < 2) continue;
    for (let i = 0; i < g.length - 1; i++) {
      const [ax, ay] = toLocalMeters(g[i].lat, g[i].lon, fix.lat, fix.lon);
      const [bx, by] = toLocalMeters(g[i + 1].lat, g[i + 1].lon, fix.lat, fix.lon);
      const { dist } = pointSegDist(0, 0, ax, ay, bx, by);
      if (dist > maxDist) continue;

      let score = dist;
      let forward = true;
      if (useHeading) {
        const brg = segBearing(ax, ay, bx, by);
        let diff = angleDiff(brg, fix.heading);
        forward = diff <= 90;
        if (way.tags.oneway === 'yes' || way.tags.oneway === '1') {
          // against a oneway: heavy penalty
          if (!forward) diff = 180;
        } else if (!forward) {
          diff = 180 - diff; // compare against reversed segment
          }
        score += diff * 0.35; // heading penalty: 35 m at 100 deg off
        if (diff > 65) continue; // clearly not our road
      }

      if (!best || score < best.score) best = { way, dist, score, forward };
    }
  }
  return best;
}

// Hysteresis: a new road must win N consecutive fixes before switching.
export class RoadStabilizer {
  constructor(needed = 2) {
    this.needed = needed;
    this.currentId = null;
    this.candidateId = null;
    this.candidateCount = 0;
  }
  // Feed the matched way id (or null); returns the stabilized id.
  update(wayId) {
    if (wayId === this.currentId) {
      this.candidateId = null;
      this.candidateCount = 0;
      return this.currentId;
    }
    // first acquisition (nothing held yet) locks immediately
    if (this.currentId === null && wayId !== null) {
      this.currentId = wayId;
      this.candidateId = null;
      this.candidateCount = 0;
      return this.currentId;
    }
    if (wayId === this.candidateId) {
      this.candidateCount++;
    } else {
      this.candidateId = wayId;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= this.needed) {
      this.currentId = this.candidateId;
      this.candidateId = null;
      this.candidateCount = 0;
    }
    return this.currentId;
  }
  reset() {
    this.currentId = null;
    this.candidateId = null;
    this.candidateCount = 0;
  }
}

// Great-circle distance in meters.
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG, dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// ---------- live service (fetch + cache + match) ----------

export class LimitService {
  constructor() {
    this.ways = [];
    this.stabilizer = new RoadStabilizer(2);
    this.lastFetchCenter = null;
    this.lastFetchTime = 0;
    this.backoffUntil = 0;
    this.mirror = 0;
    this.fetching = false;
    this.lastResult = { state: 'unknown', roadName: '' };
    this.onUpdate = null; // callback({state, kmh?, roadName})
  }

  // Called on every GPS fix.
  async onFix(fix) {
    this.maybeFetch(fix);
    const match = matchRoad(fix, this.ways);
    const stableId = this.stabilizer.update(match ? match.way.id : null);

    let result;
    if (stableId == null) {
      result = { state: 'unknown', roadName: '' };
    } else {
      const way = (match && match.way.id === stableId)
        ? match.way
        : this.ways.find((w) => w.id === stableId);
      if (!way) { result = { state: 'unknown', roadName: '' }; }
      else {
        const forward = match && match.way.id === stableId ? match.forward : true;
        const lim = limitForWay(way.tags, forward);
        result = {
          state: lim.kind,
          kmh: lim.kmh,
          roadName: way.tags.name || way.tags.ref || '',
        };
      }
    }

    const changed = result.state !== this.lastResult.state ||
      result.kmh !== this.lastResult.kmh ||
      result.roadName !== this.lastResult.roadName;
    this.lastResult = result;
    if (changed && this.onUpdate) this.onUpdate(result);
    return result;
  }

  maybeFetch(fix) {
    const now = Date.now();
    if (this.fetching || now < this.backoffUntil) return;
    if (now - this.lastFetchTime < MIN_FETCH_INTERVAL) return;
    if (this.lastFetchCenter) {
      const d = haversine(fix.lat, fix.lon, this.lastFetchCenter.lat, this.lastFetchCenter.lon);
      if (d < REFETCH_DIST) return;
    }
    this.fetch(fix.lat, fix.lon);
  }

  async fetch(lat, lon) {
    this.fetching = true;
    this.lastFetchTime = Date.now();
    const query = `[out:json][timeout:12];way(around:${FETCH_RADIUS},${lat.toFixed(6)},${lon.toFixed(6)})[highway~"${HIGHWAY_RE}"];out tags geom;`;
    try {
      const res = await fetch(MIRRORS[this.mirror], {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('overpass ' + res.status);
      const json = await res.json();
      const fresh = (json.elements || [])
        .filter((e) => e.type === 'way' && e.geometry)
        .map((e) => ({ id: e.id, tags: e.tags || {}, geometry: e.geometry }));
      // merge: keep fresh + nearby old ways not re-fetched (simple replace is fine
      // since radius > refetch distance, fresh data always covers the position)
      this.ways = fresh;
      this.lastFetchCenter = { lat, lon };
    } catch (e) {
      this.backoffUntil = Date.now() + ERROR_BACKOFF;
      this.mirror = (this.mirror + 1) % MIRRORS.length;
    } finally {
      this.fetching = false;
    }
  }
}
