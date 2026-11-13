import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals so the module can be imported in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = { hidden: false };

const { SpotifyService } = await import('../js/spotify.js');

function makeService() {
  const s = new SpotifyService();
  s.commands = [];
  s.control = async (action) => { s.commands.push(action); }; // isolate from network
  return s;
}

beforeEach(() => store.clear());

test('tapping play flips the icon state immediately (optimistic)', () => {
  const s = makeService();
  const seen = [];
  s.onPlayback = (p) => seen.push(p.isPlaying);
  s.isPlaying = false;
  s.lastPlayback = { isPlaying: false, progressMs: 5000, fetchedAt: Date.now(), durationMs: 200000 };

  s.togglePlay();

  assert.equal(s.isPlaying, true, 'state flips without waiting for the API');
  assert.deepEqual(seen, [true], 'UI is notified right away');
  assert.deepEqual(s.commands, ['play']);
});

test('tapping pause flips back and sends pause', () => {
  const s = makeService();
  const seen = [];
  s.onPlayback = (p) => seen.push(p.isPlaying);
  s.isPlaying = true;
  s.lastPlayback = { isPlaying: true, progressMs: 1000, fetchedAt: Date.now(), durationMs: 200000 };

  s.togglePlay();

  assert.equal(s.isPlaying, false);
  assert.deepEqual(seen, [false]);
  assert.deepEqual(s.commands, ['pause']);
});

test('pausing keeps the interpolated progress instead of rewinding', () => {
  const s = makeService();
  let got = null;
  s.onPlayback = (p) => { got = p; };
  s.isPlaying = true;
  // the last poll was 3 s ago while playing at 10 s into the track
  s.lastPlayback = { isPlaying: true, progressMs: 10000, fetchedAt: Date.now() - 3000, durationMs: 200000 };

  s.togglePlay();

  assert.ok(got.progressMs >= 12900 && got.progressMs <= 13100,
    `progress should carry the elapsed 3 s, got ${got.progressMs}`);
});

test('progress never runs past the end of the track', () => {
  const s = makeService();
  let got = null;
  s.onPlayback = (p) => { got = p; };
  s.isPlaying = true;
  s.lastPlayback = { isPlaying: true, progressMs: 99000, fetchedAt: Date.now() - 9000, durationMs: 100000 };

  s.togglePlay();

  assert.equal(got.progressMs, 100000);
});

test('toggling twice returns to the original state', () => {
  const s = makeService();
  s.isPlaying = true;
  s.lastPlayback = { isPlaying: true, progressMs: 0, fetchedAt: Date.now(), durationMs: 1000 };
  s.togglePlay();
  s.togglePlay();
  assert.equal(s.isPlaying, true);
  assert.deepEqual(s.commands, ['pause', 'play']);
});

test('toggle works before any poll has landed', () => {
  const s = makeService();
  s.isPlaying = false;
  s.lastPlayback = null; // nothing polled yet
  assert.doesNotThrow(() => s.togglePlay());
  assert.equal(s.isPlaying, true);
  assert.deepEqual(s.commands, ['play']);
});
