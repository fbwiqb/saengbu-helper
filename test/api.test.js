const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent } = require('../src/db');
const { createApp } = require('../src/server');

async function withServer(fn) {
  const db = open(':memory:');
  const app = createApp(db);
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

test('verify는 바이트+금지어 반환', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '창업가', area: '행특' }),
    });
    const j = await res.json();
    assert.strictEqual(j.bytes, 9);
    assert.strictEqual(j.forbiddenHits[0].term, '창업');
  });
});

test('학생 추가 후 목록', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/students`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hakbun: '99999', name: '테스트', group_tag: '통합과학1' }),
    });
    const list = await (await fetch(`${base}/api/students?group=통합과학1`)).json();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, '테스트');
  });
});

test('학번만 있는 부분 본문도 200', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/students`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hakbun: '111' }),
    });
    assert.strictEqual(res.status, 200);
    const put = await fetch(`${base}/api/students/222`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(put.status, 200);
  });
});

test('레코드 저장은 바이트 자동계산', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/students`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hakbun: '30404', name: '홍길동', group_tag: '3-4담임' }),
    });
    await fetch(`${base}/api/records/30404/자율`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '가나다', status: '초안' }),
    });
    const s = await (await fetch(`${base}/api/students/30404`)).json();
    assert.strictEqual(s.records.find(r => r.area === '자율').bytes, 9);
  });
});
