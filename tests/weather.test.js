import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeToCondition, relativeWindAngle, windSideLabel, crosswindKmh, compassLabel,
  isDayFromSunTimes, currentIsDay, localIsoMinutes,
} from '../js/weather.js';

// ---------- day / night ----------

test('evening in November is night, not day', () => {
  // the exact case seen on the phone: 20:45 local, sunset 16:25
  assert.equal(
    isDayFromSunTimes('2026-11-13T20:45', '2026-11-13T07:22', '2026-11-13T16:25'),
    false,
  );
});

test('midday is day', () => {
  assert.equal(
    isDayFromSunTimes('2026-11-13T12:00', '2026-11-13T07:22', '2026-11-13T16:25'),
    true,
  );
});

test('boundaries: sunrise counts as day, sunset as night', () => {
  const up = '2026-11-13T07:22', down = '2026-11-13T16:25';
  assert.equal(isDayFromSunTimes('2026-11-13T07:22', up, down), true);
  assert.equal(isDayFromSunTimes('2026-11-13T07:21', up, down), false);
  assert.equal(isDayFromSunTimes('2026-11-13T16:25', up, down), false);
  assert.equal(isDayFromSunTimes('2026-11-13T16:24', up, down), true);
});

test('sun times from another day are not trusted', () => {
  assert.equal(
    isDayFromSunTimes('2026-11-14T01:00', '2026-11-13T07:22', '2026-11-13T16:25'),
    null,
  );
  assert.equal(isDayFromSunTimes('2026-11-13T12:00', null, null), null);
});

test('currentIsDay recomputes from the clock, overriding a stale flag', () => {
  const data = { isDay: true, sunrise: '2026-11-13T07:22', sunset: '2026-11-13T16:25' };
  // cached at midday said "day", but it is 20:45 now -> night wins
  assert.equal(currentIsDay(data, new Date(2026, 10, 13, 20, 45)), false);
  assert.equal(currentIsDay(data, new Date(2026, 10, 13, 12, 0)), true);
});

test('currentIsDay falls back to the stored flag without sun times', () => {
  assert.equal(currentIsDay({ isDay: false }, new Date(2026, 10, 13, 12, 0)), false);
  assert.equal(currentIsDay({ isDay: true }, new Date(2026, 10, 13, 12, 0)), true);
});

test('localIsoMinutes formats local time zero-padded', () => {
  assert.equal(localIsoMinutes(new Date(2026, 10, 3, 9, 5)), '2026-11-03T09:05');
});

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
