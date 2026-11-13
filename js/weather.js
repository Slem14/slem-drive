// Live weather from Open-Meteo (free, no key, CORS-friendly).
// Pure mapping/geometry helpers are exported for unit tests.

const API = 'https://api.open-meteo.com/v1/forecast';
const REFETCH_MS = 10 * 60 * 1000;  // 10 min
const REFETCH_DIST_M = 5000;        // or when moved > 5 km
const LS_KEY = 'slemdrive.weather.v1';

// ---------- WMO weather code -> condition bucket ----------

// Conditions drive the background mood: clear | cloudy | rain | snow | fog | storm
export function codeToCondition(code) {
  if (code == null) return 'cloudy';
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';     // drizzle + rain
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';     // showers
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

export function conditionEmoji(condition, isDay) {
  switch (condition) {
    case 'clear': return isDay ? '☀️' : '🌙';
    case 'cloudy': return isDay ? '⛅️' : '☁️';
    case 'rain': return '🌧️';
    case 'snow': return '❄️';
    case 'fog': return '🌫️';
    case 'storm': return '⛈️';
    default: return '☁️';
  }
}

// ---------- wind relative to the car ----------

// windFromDeg: meteorological direction the wind comes FROM (0 = north).
// heading: direction of travel. Returns the angle the wind comes from
// relative to the car nose: 0 = head-on, 90 = from the right,
// 180 = from behind, 270 = from the left.
export function relativeWindAngle(windFromDeg, heading) {
  if (windFromDeg == null || heading == null) return null;
  return ((windFromDeg - heading) % 360 + 360) % 360;
}

// German label for the side the wind hits from (45° sectors).
export function windSideLabel(relDeg) {
  if (relDeg == null) return '';
  const sectors = [
    'von vorn', 'von vorn rechts', 'von rechts', 'von hinten rechts',
    'von hinten', 'von hinten links', 'von links', 'von vorn links',
  ];
  return sectors[Math.round(relDeg / 45) % 8];
}

// German compass label for an absolute direction — used while parked, when
// there is no heading to be relative to.
export function compassLabel(deg) {
  if (deg == null) return '';
  const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return 'aus ' + points[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Crosswind component in km/h — what actually pushes the car sideways.
export function crosswindKmh(windKmh, relDeg) {
  if (relDeg == null) return windKmh;
  return Math.abs(windKmh * Math.sin(relDeg * Math.PI / 180));
}

// ---------- service ----------

export class WeatherService {
  constructor() {
    this.data = this.loadCache();   // {tempC, feelsC, condition, isDay, windKmh, gustKmh, windFromDeg, at}
    this.lastPos = null;
    this.fetching = false;
    this.onUpdate = null;
  }

  loadCache() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY));
      // stale after 30 min — better nothing than wrong weather
      if (d && Date.now() - d.at < 30 * 60 * 1000) return d;
    } catch { /* fresh */ }
    return null;
  }

  async maybeFetch(fix) {
    if (this.fetching) return;
    const now = Date.now();
    if (this.data && now - this.data.at < REFETCH_MS && this.lastPos) {
      const dLat = (fix.lat - this.lastPos.lat) * 111320;
      const dLon = (fix.lon - this.lastPos.lon) * 111320 * Math.cos(fix.lat * Math.PI / 180);
      if (Math.hypot(dLat, dLon) < REFETCH_DIST_M) return;
    }
    this.fetching = true;
    try {
      const params = new URLSearchParams({
        latitude: fix.lat.toFixed(4),
        longitude: fix.lon.toFixed(4),
        current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m',
        wind_speed_unit: 'kmh',
        timezone: 'auto',
      });
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error('open-meteo ' + res.status);
      const json = await res.json();
      const c = json.current;
      this.data = {
        at: Date.now(),
        tempC: Math.round(c.temperature_2m),
        feelsC: Math.round(c.apparent_temperature),
        condition: codeToCondition(c.weather_code),
        isDay: !!c.is_day,
        windKmh: Math.round(c.wind_speed_10m),
        gustKmh: Math.round(c.wind_gusts_10m),
        windFromDeg: c.wind_direction_10m,
      };
      this.lastPos = { lat: fix.lat, lon: fix.lon };
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* full */ }
      if (this.onUpdate) this.onUpdate(this.data);
    } catch {
      // network/API trouble: keep whatever we had, retry on a later fix
    } finally {
      this.fetching = false;
    }
  }
}
