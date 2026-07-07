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

test('기타 그룹(영역 미설정)도 기본 영역으로 저장·추적됨', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/groups`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group_tag: '멘토링', category: '기타' }),
    });
    await fetch(`${base}/api/students`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hakbun: '30401', name: '홍길동', group_tag: '멘토링' }),
    });
    const put = await fetch(`${base}/api/records/30401/${encodeURIComponent('기타')}?subject=${encodeURIComponent('멘토링')}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '멘토링 활동 기록', status: '미작성' }),
    });
    assert.strictEqual(put.status, 200);
    const list = await (await fetch(`${base}/api/students?group=${encodeURIComponent('멘토링')}`)).json();
    assert.strictEqual(list[0].prog.total, 1);
    assert.strictEqual(list[0].prog.started, 1);
  });
});

test('명단 업로드: 이름(성적) → 이름만 저장 + 성적은 내신으로, 담임에 안 번짐', async () => {
  const bulk = (base, g, c, students) => fetch(`${base}/api/students/bulk`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ group_tag: g, category: c, students }),
  });
  await withServer(async (base) => {
    await bulk(base, '3-4반', '담임', [{ hakbun: '30401', name: '강하연' }]);
    await bulk(base, '고급생명 1', '세특', [{ hakbun: '30401', name: '강하연(5.15)' }]);
    const damim = await (await fetch(`${base}/api/students?group=${encodeURIComponent('3-4반')}`)).json();
    assert.strictEqual(damim[0].name, '강하연');
    const s = await (await fetch(`${base}/api/students/30401`)).json();
    assert.strictEqual(s.name, '강하연');
    assert.strictEqual(s.naesin, 5.15);
  });
});
