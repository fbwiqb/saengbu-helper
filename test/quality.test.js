const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, upsertRecord, qualityStats, promoteExemplar, listExemplars } = require('../src/db');
const { createApp } = require('../src/server');

function freshDb() { return open(':memory:'); }

test('records 품질 컬럼 마이그레이션', () => {
  const db = freshDb();
  const cols = db.prepare('PRAGMA table_info(records)').all().map((c) => c.name);
  for (const c of ['q_exp', 'q_think', 'q_growth', 'q_authentic', 'accepted']) assert.ok(cols.includes(c), c);
});

test('qualityStats 영역별 평균/채택률', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'B', name: '나', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: 'x', bytes: 1, q_exp: 4, q_think: 5, q_growth: 3, q_authentic: 4, accepted: 1 });
  upsertRecord(db, { hakbun: 'B', area: '자율', subject: '', body: 'y', bytes: 1, q_exp: 2, q_think: 3, q_growth: 3, q_authentic: 2, accepted: 0 });
  const stats = qualityStats(db, '3-4담임');
  const jayul = stats.find((s) => s.area === '자율');
  assert.strictEqual(jayul.q_exp, 3);
  assert.strictEqual(jayul.q_think, 4);
  assert.strictEqual(jayul.acceptRate, 50);
});

test('promoteExemplar 우수예시 적재', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '본문', revised: '우수한 본문', bytes: 1 });
  const ex = promoteExemplar(db, 'A', '자율', '');
  assert.strictEqual(ex.text, '우수한 본문');
  assert.strictEqual(listExemplars(db, '3-4담임').length, 1);
});

test('promoteExemplar 없는 레코드는 null', () => {
  const db = freshDb();
  assert.strictEqual(promoteExemplar(db, 'Z', '자율', ''), null);
});

test('PUT /api/records 품질 저장 + GET /api/quality + POST /api/promote', async () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  const srv = createApp(db).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    await fetch(`${base}/api/records/A/자율`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '본문', q_exp: 5, q_think: 4, q_growth: 4, q_authentic: 5, accepted: true }),
    });
    const stats = await (await fetch(`${base}/api/quality?group=3-4담임`)).json();
    assert.strictEqual(stats.find((s) => s.area === '자율').q_exp, 5);
    assert.strictEqual(stats.find((s) => s.area === '자율').acceptRate, 100);
    const pr = await (await fetch(`${base}/api/promote/A/자율`, { method: 'POST' })).json();
    assert.strictEqual(pr.hakbun, 'A');
    const miss = await fetch(`${base}/api/promote/Z/자율`, { method: 'POST' });
    assert.strictEqual(miss.status, 404);
  } finally { srv.close(); }
});
