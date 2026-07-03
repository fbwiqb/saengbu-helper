const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadRules, scan } = require('../src/forbidden');

const RULES = loadRules(path.join(__dirname, '../data/forbidden.json'));

test('규칙 로드 — 금지어 포함', () => {
  assert.ok(RULES.terms.some((t) => t.term === '창업'));
  assert.ok(RULES.terms.some((t) => t.term === '충남삼성고'));
});

test('일반 한글 오탐 없음', () => {
  assert.strictEqual(scan('빛나는 모습으로 느낌표를 강조했다', RULES).length, 0);
});

test('학교 유추어 — 가장 긴 것만 남기고 중복 제거', () => {
  const hits = scan('충남삼성고등학교에서 탐구함', RULES);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].term, '충남삼성고등학교');
  assert.strictEqual(hits[0].cat, '학교유추');
});

test('브랜드 대체어 제안', () => {
  const yt = scan('유튜브 영상을 제작함', RULES).find((h) => h.term === '유튜브');
  assert.ok(yt);
  assert.strictEqual(yt.replace, '동영상 공유 플랫폼');
});

test('순위 표기 정규식 탐지', () => {
  assert.ok(scan('교내 대회에서 동상(10위)을 수상함', RULES).some((h) => h.cat === '순위'));
});

test('영문 경계 — EU 단독은 걸림', () => {
  assert.ok(scan('EU 정책을 조사함', RULES).some((h) => h.term === 'EU'));
});

test('배열 규칙 하위호환 — 인덱스 정렬 반환', () => {
  const hits = scan('학생은 창업을 했고 또 창업함', ['창업']);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].term, '창업');
  assert.ok(hits[0].index < hits[1].index);
});
