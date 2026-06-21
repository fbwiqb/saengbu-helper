const test = require('node:test');
const assert = require('node:assert');
const { extractBooks } = require('../src/books');

test('제목(저자) 추출', () => {
  const r = extractBooks("도서 '이기적 유전자(리처드 도킨스)'를 읽고");
  assert.deepStrictEqual(r, [{ title: '이기적 유전자', author: '리처드 도킨스' }]);
});

test('복수 저자 외', () => {
  const r = extractBooks("'코스모스(칼 세이건 외)'");
  assert.strictEqual(r[0].author, '칼 세이건 외');
});

test('따옴표 없으면 무시', () => {
  assert.strictEqual(extractBooks('운동량(질량) 개념').length, 0);
});
