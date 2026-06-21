const test = require('node:test');
const assert = require('node:assert');
const { calcBytes, evaluate, TARGETS } = require('../src/bytes');

test('한글3 영문1 엔터2', () => {
  assert.strictEqual(calcBytes('가'), 3);
  assert.strictEqual(calcBytes('a1 '), 3);
  assert.strictEqual(calcBytes('가\n나'), 8);
});

test('이모지 4바이트', () => {
  assert.strictEqual(calcBytes('😀'), Buffer.byteLength('😀'));
  assert.strictEqual(calcBytes('😀😀😀😀'), 16);
});

test('CRLF는 줄바꿈 2바이트', () => {
  assert.strictEqual(calcBytes('가\r\n나'), 8);
  assert.strictEqual(calcBytes('a\rb'), 4);
});

test('영역 목표', () => {
  assert.strictEqual(TARGETS.자율, 1500);
  assert.strictEqual(TARGETS.진로, 1500);
  assert.strictEqual(TARGETS.행특, 900);
  assert.strictEqual(TARGETS.세특, 1500);
});

test('평가 상태', () => {
  assert.strictEqual(evaluate('가'.repeat(300), '행특').status, 'full'); // 900/900
  assert.strictEqual(evaluate('가'.repeat(301), '행특').status, 'over'); // 903>900
  assert.strictEqual(evaluate('가'.repeat(100), '행특').status, 'low');  // 300<70%
  assert.strictEqual(evaluate('가'.repeat(250), '행특').status, 'ok');   // 750=83%
});
