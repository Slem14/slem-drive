// Demo mode: simulated drive (speed + limits + road names) and a fake
// track with original placeholder lyrics, so everything can be tested
// at home without GPS or Spotify.

// Drive script: [duration s, target km/h, limit state, road name]
const DRIVE = [
  [6,   0,  { state: 'limit', kmh: 50 },  'Hauptstraße'],
  [10,  48, { state: 'limit', kmh: 50 },  'Hauptstraße'],
  [8,   32, { state: 'limit', kmh: 30 },  'Gartenweg (Zone 30)'],
  [8,   58, { state: 'limit', kmh: 50 },  'Hauptstraße'],
  [10,  97, { state: 'limit', kmh: 100 }, 'L 147'],
  [16, 158, { state: 'none' },            'A 9'], // no limit: 130–160 is normal cruising, no warning
  [10, 136, { state: 'limit', kmh: 120 }, 'A 9'], // overspeed: triggers the warning
  [8,  128, { state: 'variable' },        'A 9'],
  [8,   75, { state: 'limit', kmh: 100 }, 'L 147'],
  [6,   12, { state: 'walk' },            'Spielstraße'],
  [6,    0, { state: 'unknown' },         ''],
];

// Original placeholder lyrics (not from any real song).
const DEMO_LRC = `
[00:02.00]Motor an, die Nacht beginnt
[00:06.50]Lichter ziehen am Glas vorbei
[00:11.00]Jede Straße kennt den Wind
[00:15.50]Und der Tacho läuft dabei
[00:20.00]
[00:24.00]Neonblau auf nassem Teer
[00:28.50]Die Stadt singt leise ihren Ton
[00:33.00]Hundert Meter, hundert mehr
[00:37.50]Wir fahren schon so lange schon
[00:42.00]
[00:46.00]Slem Drive, wir gleiten durch die Nacht
[00:50.50]Slem Drive, die Farben sind erwacht
[00:55.00]Kein Ziel, nur dieser Augenblick
[00:59.50]Die Lichter spiegeln das Glück
[01:04.00]
[01:10.00]Autobahn, der Himmel offen weit
[01:14.50]Der Mond fährt nebenher
[01:19.00]Zwischen jetzt und Ewigkeit
[01:23.50]Wiegt die Nacht nicht schwer
[01:28.00]
[01:32.00]Slem Drive, wir gleiten durch die Nacht
[01:36.50]Slem Drive, die Farben sind erwacht
[01:41.00]Kein Ziel, nur dieser Augenblick
[01:45.50]Die Lichter spiegeln das Glück
[01:50.00]
[01:56.00]Und am Ende dieser Fahrt
[02:00.50]Bleibt ein Leuchten auf der Haut
[02:05.00]Jeder Kilometer zart
[02:09.50]Hat uns ein Zuhause gebaut
`;

export const DEMO_TRACK = {
  id: 'demo-track',
  title: 'Nachtfahrt',
  artist: 'Slem Drive Demo',
  album: 'Demo',
  durationMs: 140000,
  cover: null, // generated below
};

export { DEMO_LRC };

// Generate a colorful cover on a canvas so palette extraction has
// something to chew on.
export function demoCover() {
  const c = document.createElement('canvas');
  c.width = 300; c.height = 300;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 300, 300);
  g.addColorStop(0, '#701c30');
  g.addColorStop(0.5, '#c0392b');
  g.addColorStop(1, '#ff8c42');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 300, 300);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(150, 150, 80, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '600 34px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('♪', 150, 162);
  return c.toDataURL('image/png');
}

export class DemoMode {
  constructor({ onFix, onLimit, onTrack, onPlayback }) {
    this.onFix = onFix;
    this.onLimit = onLimit;
    this.onTrack = onTrack;
    this.onPlayback = onPlayback;
    this.timer = null;
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.phase = 0;
    this.phaseT = 0;
    this.speed = 0;
    this.songT = 0;
    this.lastLimitKey = null;

    const cover = demoCover();
    this.onTrack({ ...DEMO_TRACK, cover });

    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1);
      last = now;
      this.tick(dt);
    }, 200);
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.onTrack(null);
  }

  tick(dt) {
    const seg = DRIVE[this.phase];
    this.phaseT += dt;
    if (this.phaseT >= seg[0]) {
      this.phaseT = 0;
      this.phase = (this.phase + 1) % DRIVE.length;
    }
    const target = DRIVE[this.phase][1];
    // approach target speed with gentle acceleration
    this.speed += (target - this.speed) * Math.min(dt * 0.9, 1);
    const jitter = this.speed > 3 ? (Math.random() - 0.5) * 1.2 : 0;

    this.onFix({
      lat: 51.0, lon: 11.0,
      speedKmh: Math.max(0, this.speed + jitter),
      heading: 42,
      accuracy: 8,
      demo: true,
    });

    const [, , limit, road] = DRIVE[this.phase];
    const key = limit.state + (limit.kmh || '') + road;
    if (key !== this.lastLimitKey) {
      this.lastLimitKey = key;
      this.onLimit({ ...limit, roadName: road });
    }

    // loop the demo song
    this.songT += dt * 1000;
    if (this.songT >= DEMO_TRACK.durationMs) {
      this.songT = 0;
      this.onTrack({ ...DEMO_TRACK, cover: demoCover() });
    }
    this.onPlayback({
      isPlaying: true,
      progressMs: this.songT,
      fetchedAt: Date.now(),
      durationMs: DEMO_TRACK.durationMs,
    });
  }
}
