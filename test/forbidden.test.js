const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadForbidden, scan } = require('../src/forbidden');

test('금지어 로드', () => {
  const terms = loadForbidden(path.join(__dirname, '../data/forbidden.json'));
  assert.ok(terms.includes('창업'));
});

test('일반 한글 오탐 없음', () => {
  const terms = loadForbidden(path.join(__dirname, '../data/forbidden.json'));
  assert.strictEqual(scan('빛나는 모습으로 느낌표를 강조했다', terms).length, 0);
});

test('스캔은 인덱스를 정렬 반환', () => {
  const hits = scan('학생은 창업을 했고 또 창업함', ['창업']);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].term, '창업');
  assert.ok(hits[0].index < hits[1].index);
});
