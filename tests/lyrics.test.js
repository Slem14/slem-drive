import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLRC, activeLineIndex, cleanTitle } from '../js/lyrics.js';

// ---------- LRC parsing ----------

test('basic LRC lines sorted by time', () => {
  const lines = parseLRC('[00:10.00]second\n[00:05.00]first');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'first');
  assert.equal(lines[0].time, 5);
  assert.equal(lines[1].time, 10);
});

test('multiple timestamps per line', () => {
  const lines = parseLRC('[00:05.00][01:05.00]chorus');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].time, 5);
  assert.equal(lines[1].time, 65);
  assert.equal(lines[1].text, 'chorus');
});

test('empty lines kept as instrumental gaps', () => {
  const lines = parseLRC('[00:01.00]text\n[00:05.00]\n[00:09.00]more');
  assert.equal(lines.length, 3);
  assert.equal(lines[1].text, '');
});

test('hundredths and colon-separated fractions', () => {
  assert.equal(parseLRC('[01:30.55]x')[0].time, 90.55);
  assert.equal(parseLRC('[01:30:55]x')[0].time, 90.55);
});

test('metadata tags are ignored', () => {
  const lines = parseLRC('[ar:Artist]\n[ti:Title]\n[00:05.00]real line');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'real line');
});

// ---------- active line ----------

test('activeLineIndex binary search', () => {
  const lines = [{ time: 5 }, { time: 10 }, { time: 20 }];
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 5), 0);
  assert.equal(activeLineIndex(lines, 9.9), 0);
  assert.equal(activeLineIndex(lines, 10), 1);
  assert.equal(activeLineIndex(lines, 999), 2);
});

// ---------- title cleaning ----------

test('strips remaster suffixes', () => {
  assert.equal(cleanTitle('Song - Remastered 2011'), 'Song');
  assert.equal(cleanTitle('Song (2009 Remastered Version)'), 'Song');
});

test('strips feat', () => {
  assert.equal(cleanTitle('Song (feat. Somebody)'), 'Song');
  assert.equal(cleanTitle('Song feat. Somebody'), 'Song');
});

test('strips live and radio edit', () => {
  assert.equal(cleanTitle('Song - Live at Wembley'), 'Song');
  assert.equal(cleanTitle('Song - Radio Edit'), 'Song');
});

test('leaves normal titles alone', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('99 Luftballons'), '99 Luftballons');
});
