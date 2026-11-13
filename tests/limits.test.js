import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMaxspeedValue, limitForWay, pointSegDist, toLocalMeters,
  matchRoad, RoadStabilizer, segBearing, angleDiff, haversine,
  parseConditional, isRoadworks,
} from '../js/limits.js';

// Fixed clocks for conditional-limit tests.
const WED_23H = new Date(2026, 10, 11, 23, 30); // Wednesday 23:30
const WED_12H = new Date(2026, 10, 11, 12, 0);  // Wednesday 12:00
const SUN_12H = new Date(2026, 10, 15, 12, 0);  // Sunday 12:00

// ---------- maxspeed parsing (all cases from the plan) ----------

test('numeric maxspeed', () => {
  assert.deepEqual(parseMaxspeedValue('50'), { kind: 'limit', kmh: 50 });
  assert.deepEqual(parseMaxspeedValue('100'), { kind: 'limit', kmh: 100 });
  assert.deepEqual(parseMaxspeedValue(' 30 '), { kind: 'limit', kmh: 30 });
});

test('mph conversion', () => {
  assert.deepEqual(parseMaxspeedValue('30 mph'), { kind: 'limit', kmh: 48 });
  assert.deepEqual(parseMaxspeedValue('70mph'), { kind: 'limit', kmh: 113 });
});

test('DE presets', () => {
  assert.deepEqual(parseMaxspeedValue('DE:urban'), { kind: 'limit', kmh: 50 });
  assert.deepEqual(parseMaxspeedValue('DE:rural'), { kind: 'limit', kmh: 100 });
});

test('no limit', () => {
  assert.equal(parseMaxspeedValue('none').kind, 'none');
  assert.equal(parseMaxspeedValue('DE:motorway').kind, 'none');
});

test('zones', () => {
  assert.deepEqual(parseMaxspeedValue('DE:zone30'), { kind: 'limit', kmh: 30 });
  assert.deepEqual(parseMaxspeedValue('DE:zone:30'), { kind: 'limit', kmh: 30 });
});

test('walking pace', () => {
  assert.equal(parseMaxspeedValue('walk').kind, 'walk');
  assert.equal(parseMaxspeedValue('DE:living_street').kind, 'walk');
});

test('variable', () => {
  assert.equal(parseMaxspeedValue('signals').kind, 'variable');
  assert.equal(parseMaxspeedValue('variable').kind, 'variable');
});

test('multiple values take the lower', () => {
  assert.deepEqual(parseMaxspeedValue('50;30'), { kind: 'limit', kmh: 30 });
  assert.deepEqual(parseMaxspeedValue('100; 60'), { kind: 'limit', kmh: 60 });
});

test('garbage is unknown', () => {
  assert.equal(parseMaxspeedValue('fast').kind, 'unknown');
  assert.equal(parseMaxspeedValue('').kind, 'unknown');
  assert.equal(parseMaxspeedValue(null).kind, 'unknown');
});

// ---------- limitForWay ----------

test('direction-specific tags win', () => {
  const tags = { maxspeed: '100', 'maxspeed:forward': '80', 'maxspeed:backward': '60' };
  assert.deepEqual(limitForWay(tags, true), { kind: 'limit', kmh: 80 });
  assert.deepEqual(limitForWay(tags, false), { kind: 'limit', kmh: 60 });
});

test('zone:maxspeed fallback when maxspeed missing', () => {
  assert.deepEqual(limitForWay({ 'zone:maxspeed': 'DE:30' }, true), { kind: 'unknown' });
  assert.deepEqual(limitForWay({ 'zone:maxspeed': 'DE:zone:30' }, true), { kind: 'limit', kmh: 30 });
});

test('untagged motorway is no-limit, other untagged roads unknown', () => {
  assert.equal(limitForWay({ highway: 'motorway' }, true).kind, 'none');
  assert.equal(limitForWay({ highway: 'residential' }, true).kind, 'unknown');
  assert.equal(limitForWay({ highway: 'living_street' }, true).kind, 'walk');
});

// ---------- conditional limits ----------

test('night window active and inactive', () => {
  const cond = '30 @ (22:00-06:00)';
  assert.deepEqual(parseConditional(cond, WED_23H), { kind: 'limit', kmh: 30 });
  assert.equal(parseConditional(cond, WED_12H), null);
});

test('weekday window respects the day', () => {
  const cond = '60 @ (Mo-Fr 07:00-17:00)';
  assert.deepEqual(parseConditional(cond, WED_12H), { kind: 'limit', kmh: 60 });
  assert.equal(parseConditional(cond, SUN_12H), null, 'must not apply on Sunday');
});

test('non-time conditions are ignored, never guessed', () => {
  assert.equal(parseConditional('100 @ wet', WED_12H), null);
  assert.equal(parseConditional('nonsense', WED_12H), null);
  assert.equal(parseConditional(null, WED_12H), null);
});

test('conditional limit overrides the plain maxspeed while active', () => {
  const tags = { highway: 'residential', maxspeed: '50', 'maxspeed:conditional': '30 @ (22:00-06:00)' };
  assert.deepEqual(limitForWay(tags, true, WED_23H), { kind: 'limit', kmh: 30 });
  assert.deepEqual(limitForWay(tags, true, WED_12H), { kind: 'limit', kmh: 50 });
});

test('direction-specific conditional limits', () => {
  const tags = {
    highway: 'primary', maxspeed: '100',
    'maxspeed:forward:conditional': '80 @ (06:00-20:00)',
  };
  assert.deepEqual(limitForWay(tags, true, WED_12H), { kind: 'limit', kmh: 80 });
  assert.deepEqual(limitForWay(tags, false, WED_12H), { kind: 'limit', kmh: 100 });
});

// ---------- roadworks ----------

test('roadworks detection', () => {
  assert.equal(isRoadworks({ highway: 'construction' }), true);
  assert.equal(isRoadworks({ highway: 'motorway', construction: 'widening' }), true);
  assert.equal(isRoadworks({ highway: 'motorway' }), false);
});

// ---------- geometry ----------

test('pointSegDist basic', () => {
  // point above the middle of a horizontal segment
  const { dist, t } = pointSegDist(5, 3, 0, 0, 10, 0);
  assert.equal(dist, 3);
  assert.equal(t, 0.5);
});

test('pointSegDist clamps to endpoints', () => {
  const { dist, t } = pointSegDist(-4, 0, 0, 0, 10, 0);
  assert.equal(dist, 4);
  assert.equal(t, 0);
});

test('toLocalMeters roughly correct near 51°N', () => {
  const [x, y] = toLocalMeters(51.001, 11.0, 51.0, 11.0);
  assert.ok(Math.abs(y - 111.19) < 1, `y=${y}`);
  assert.ok(Math.abs(x) < 0.01);
});

test('segBearing and angleDiff', () => {
  assert.equal(segBearing(0, 0, 0, 10), 0);   // north
  assert.equal(segBearing(0, 0, 10, 0), 90);  // east
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(90, 270), 180);
});

test('haversine ~111km per degree latitude', () => {
  const d = haversine(51, 11, 52, 11);
  assert.ok(Math.abs(d - 111195) < 300, `d=${d}`);
});

// ---------- road matching ----------

const streetNS = {
  id: 1,
  tags: { highway: 'residential', maxspeed: '30', name: 'Nordstraße' },
  geometry: [{ lat: 51.0, lon: 11.0 }, { lat: 51.002, lon: 11.0 }], // runs north
};
const streetEW = {
  id: 2,
  tags: { highway: 'primary', maxspeed: '50', name: 'Oststraße' },
  geometry: [{ lat: 51.0, lon: 10.999 }, { lat: 51.0, lon: 11.001 }], // runs east
};

test('matchRoad picks the nearest way', () => {
  // 20 m east of the N-S street, far from nothing else
  const fix = { lat: 51.001, lon: 11.0 + 0.0003, speedKmh: 5, heading: null, accuracy: 10 };
  const m = matchRoad(fix, [streetNS]);
  assert.ok(m);
  assert.equal(m.way.id, 1);
  assert.ok(m.dist > 15 && m.dist < 27, `dist=${m.dist}`);
});

test('matchRoad rejects far roads', () => {
  const fix = { lat: 51.01, lon: 11.01, speedKmh: 5, heading: null, accuracy: 10 };
  assert.equal(matchRoad(fix, [streetNS, streetEW]), null);
});

test('heading penalty prefers the aligned road at an intersection', () => {
  // at the crossing point of both streets, heading north at 50 km/h
  const fix = { lat: 51.0, lon: 11.0, speedKmh: 50, heading: 0, accuracy: 8 };
  const m = matchRoad(fix, [streetEW, streetNS]);
  assert.ok(m);
  assert.equal(m.way.id, 1, 'should match the north-south street');
});

test('heading detects backward travel on two-way roads', () => {
  const fix = { lat: 51.001, lon: 11.0, speedKmh: 50, heading: 180, accuracy: 8 };
  const m = matchRoad(fix, [streetNS]);
  assert.ok(m);
  assert.equal(m.forward, false);
});

test('oneway against travel direction is rejected', () => {
  const oneway = { ...streetNS, id: 3, tags: { ...streetNS.tags, oneway: 'yes' } };
  const fix = { lat: 51.001, lon: 11.0, speedKmh: 50, heading: 180, accuracy: 8 };
  assert.equal(matchRoad(fix, [oneway]), null);
});

// ---------- hysteresis ----------

test('stabilizer locks the first road immediately', () => {
  const s = new RoadStabilizer(2);
  assert.equal(s.update(1), 1);
});

test('stabilizer full behaviour', () => {
  const s = new RoadStabilizer(2);
  assert.equal(s.update(1), 1);
  // single blip of road 2 at an intersection must not switch
  assert.equal(s.update(2), 1);
  assert.equal(s.update(1), 1);
  // two consecutive fixes on road 2 switch
  assert.equal(s.update(2), 1);
  assert.equal(s.update(2), 2);
  // null (no match) also needs persistence
  assert.equal(s.update(null), 2);
  assert.equal(s.update(null), null);
});
