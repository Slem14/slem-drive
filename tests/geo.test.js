import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothSpeedStep } from '../js/geo.js';

const FRAME = 1 / 60;

// Run the smoothing at 60 fps until the displayed value rounds to the target,
// and report how long that took.
function secondsToShow(from, to) {
  let v = from;
  for (let i = 0; i < 600; i++) {
    v = smoothSpeedStep(v, to, FRAME);
    if (Math.round(v) === Math.round(to)) return (i + 1) * FRAME;
  }
  return Infinity;
}

test('hard braking shows up almost immediately', () => {
  // 120 -> 80 after a brake; the number must not crawl
  const t = secondsToShow(120, 80);
  assert.ok(t < 0.25, `took ${t.toFixed(3)}s to read 80`);
});

test('acceleration keeps up', () => {
  const t = secondsToShow(50, 90);
  assert.ok(t < 0.25, `took ${t.toFixed(3)}s to read 90`);
});

test('coming to a stop is immediate', () => {
  const t = secondsToShow(30, 0);
  assert.ok(t < 0.25, `took ${t.toFixed(3)}s to read 0`);
});

test('small GPS wobble is still smoothed, not snapped', () => {
  // a 1 km/h jitter should not jump in a single frame
  const next = smoothSpeedStep(100, 101, FRAME);
  assert.ok(next > 100 && next < 100.5, `moved to ${next}, expected a partial step`);
});

test('converges exactly instead of creeping forever', () => {
  let v = 0;
  for (let i = 0; i < 200; i++) v = smoothSpeedStep(v, 100, FRAME);
  assert.equal(v, 100);
});

test('never overshoots on a long frame', () => {
  // a dropped frame (200 ms) must not fly past the target
  const up = smoothSpeedStep(50, 100, 0.2);
  assert.ok(up <= 100, `overshot to ${up}`);
  const down = smoothSpeedStep(100, 50, 0.2);
  assert.ok(down >= 50, `overshot to ${down}`);
});
