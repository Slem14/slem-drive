// GPS speed with smoothing. Emits fixes to a callback; demo.js can feed
// synthetic fixes through the same interface.

import { haversine } from './limits.js';

const JITTER_FLOOR_KMH = 2; // show 0 below this

export class GeoService {
  constructor() {
    this.watchId = null;
    this.lastPos = null;       // previous fix for fallback speed
    this.rawKmh = 0;           // latest raw speed
    this.displayKmh = 0;       // lerped per frame by main.js
    this.accuracy = Infinity;
    this.heading = null;
    this.lastFixAt = 0;
    this.onFix = null;         // callback({lat, lon, speedKmh, heading, accuracy})
    this.onError = null;
  }

  start() {
    if (this.watchId != null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handle(pos),
      (err) => { if (this.onError) this.onError(err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }

  stop() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  handle(pos) {
    const c = pos.coords;
    let kmh = null;
    if (c.speed != null && c.speed >= 0) {
      kmh = c.speed * 3.6;
    } else if (this.lastPos) {
      // fallback: distance between consecutive fixes
      const dt = (pos.timestamp - this.lastPos.timestamp) / 1000;
      if (dt > 0.3 && dt < 10) {
        const d = haversine(this.lastPos.lat, this.lastPos.lon, c.latitude, c.longitude);
        kmh = (d / dt) * 3.6;
      }
    }
    if (kmh == null) kmh = this.rawKmh;
    if (kmh < JITTER_FLOOR_KMH) kmh = 0;

    this.rawKmh = kmh;
    this.accuracy = c.accuracy ?? Infinity;
    this.heading = (c.heading != null && !Number.isNaN(c.heading) && kmh > 3) ? c.heading : this.heading;
    this.lastPos = { lat: c.latitude, lon: c.longitude, timestamp: pos.timestamp };
    this.lastFixAt = Date.now();

    if (this.onFix) {
      this.onFix({
        lat: c.latitude,
        lon: c.longitude,
        speedKmh: kmh,
        heading: this.heading,
        accuracy: this.accuracy,
      });
    }
  }

  // GPS quality: 'good' | 'ok' | 'bad' (also bad when fixes stop coming)
  quality() {
    if (Date.now() - this.lastFixAt > 6000) return 'bad';
    if (this.accuracy < 15) return 'good';
    if (this.accuracy < 40) return 'ok';
    return 'bad';
  }
}
