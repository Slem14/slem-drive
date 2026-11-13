import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeToCondition, relativeWindAngle, windSideLabel, crosswindKmh, compassLabel,
} from '../js/weather.js';

test('compass labels for parked state', () => {
  assert.equal(compassLabel(0), 'aus N');
  assert.equal(compassLabel(90), 'aus O');
  assert.equal(compassLabel(225), 'aus SW');
  assert.equal(compassLabel(350), 'aus N');
  assert.equal(compassLabel(null), '');
});

// ---------- WMO code mapping ----------

test('clear and cloudy codes', () => {
  assert.equal(codeToCondition(0), 'clear');
  assert.equal(codeToCondition(1), 'clear');
  assert.equal(codeToCondition(2), 'cloudy');
  assert.equal(codeToCondition(3), 'cloudy');
});

test('fog, rain, snow, storm codes', () => {
  assert.equal(codeToCondition(45), 'fog');
  assert.equal(codeToCondition(48), 'fog');
  assert.equal(codeToCondition(53), 'rain');  // drizzle
  assert.equal(codeToCondition(63), 'rain');
  assert.equal(codeToCondition(81), 'rain');  // showers
  assert.equal(codeToCondition(71), 'snow');
  assert.equal(codeToCondition(86), 'snow');  // snow showers
  assert.equal(codeToCondition(95), 'storm');
  assert.equal(codeToCondition(99), 'storm');
});

test('unknown codes fall back to cloudy', () => {
  assert.equal(codeToCondition(null), 'cloudy');
  assert.equal(codeToCondition(42), 'cloudy');
});

// ---------- relative wind ----------

test('headwind: wind from the north while driving north', () => {
  assert.equal(relativeWindAngle(0, 0), 0);
});

test('wind from the right', () => {
  // driving north, wind from the east -> hits from the right
  assert.equal(relativeWindAngle(90, 0), 90);
  assert.equal(windSideLabel(90), 'von rechts');
});

test('tailwind', () => {
  // driving west (270), wind from the east (90) -> from behind
  assert.equal(relativeWindAngle(90, 270), 180);
  assert.equal(windSideLabel(180), 'von hinten');
});

test('wraps across north', () => {
  // driving at 350°, wind from 10° -> 20° off the nose
  assert.equal(relativeWindAngle(10, 350), 20);
  assert.equal(windSideLabel(20), 'von vorn');
});

test('diagonal sectors', () => {
  assert.equal(windSideLabel(45), 'von vorn rechts');
  assert.equal(windSideLabel(225), 'von hinten links');
  assert.equal(windSideLabel(315), 'von vorn links');
});

test('null inputs give null angle', () => {
  assert.equal(relativeWindAngle(null, 90), null);
  assert.equal(relativeWindAngle(90, null), null);
});

// ---------- crosswind component ----------

test('pure crosswind pushes with full force', () => {
  assert.ok(Math.abs(crosswindKmh(60, 90) - 60) < 0.001);
  assert.ok(Math.abs(crosswindKmh(60, 270) - 60) < 0.001);
});

test('head/tailwind has no sideways component', () => {
  assert.ok(crosswindKmh(60, 0) < 0.001);
  assert.ok(crosswindKmh(60, 180) < 0.001);
});

test('45 degrees gives ~71 percent', () => {
  assert.ok(Math.abs(crosswindKmh(100, 45) - 70.71) < 0.1);
});
