const test = require('node:test');
const assert = require('node:assert');
const { parse, isStylistic } = require('../src/spell');

test('parse가 correctMethod를 추출한다', () => {
  const html = `<script> data = [{"errInfo":[
    {"orgStr":"되요","candWord":"돼요","help":"한글 맞춤법 제35항","correctMethod":2},
    {"orgStr":"할수있다","candWord":"할 수 있다","help":"'-을 수 있는'을 쓰는 버릇은 외래어 영향으로 보입니다. [한겨레신문]","correctMethod":7}
  ]}]; </script>`;
  const errs = parse(html);
  assert.strictEqual(errs.length, 2);
  assert.strictEqual(errs[0].correctMethod, 2);
  assert.strictEqual(errs[1].correctMethod, 7);
});

test('isStylistic: correctMethod 4/7은 문체 훈수', () => {
  assert.strictEqual(isStylistic({ correctMethod: 4, help: '' }), true);
  assert.strictEqual(isStylistic({ correctMethod: 7, help: '' }), true);
  assert.strictEqual(isStylistic({ correctMethod: 2, help: '한글 맞춤법 제5항' }), false);
  assert.strictEqual(isStylistic({ correctMethod: 1, help: '띄어쓰기' }), false);
});

test('isStylistic: 신문 인용·문체 표현 help 차단', () => {
  assert.strictEqual(isStylistic({ help: '...로 보입니다. [한겨레신문]' }), true);
  assert.strictEqual(isStylistic({ help: '쓰는 버릇은 고치는 것이 좋습니다' }), true);
  assert.strictEqual(isStylistic({ help: '번역 투 표현입니다' }), true);
  assert.strictEqual(isStylistic({ help: '외래어 영향으로 보입니다' }), true);
  assert.strictEqual(isStylistic({ help: '표준국어대사전에 따르면 올바른 표기입니다' }), false);
});
