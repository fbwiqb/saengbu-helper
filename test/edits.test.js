const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, upsertRecord, recentEdits } = require('../src/db');
const { createApp } = require('../src/server');

function freshDb() { return open(':memory:'); }

test('upsertRecord 본문 변경 시 edits_log 기록', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '첫 본문', bytes: 1 });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '수정된 본문', bytes: 1 });
  const edits = recentEdits(db, '3-4담임');
  assert.strictEqual(edits.length, 1);
  assert.strictEqual(edits[0].before, '첫 본문');
  assert.strictEqual(edits[0].after, '수정된 본문');
});

test('첫 작성과 동일 본문은 로그 미기록', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '본문', bytes: 1 });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '본문', bytes: 1, status: '완료' });
  assert.strictEqual(recentEdits(db, '3-4담임').length, 0);
});

test('revised 우선 비교', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: 'b', revised: '교정본', bytes: 1 });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: 'b', revised: '교정본2', bytes: 1 });
  const edits = recentEdits(db, '3-4담임');
  assert.strictEqual(edits[0].before, '교정본');
  assert.strictEqual(edits[0].after, '교정본2');
});

test('GET /api/edits 그룹 필터', async () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'B', name: '나', group_tag: '통합과학1' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: 'x', bytes: 1 });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: 'y', bytes: 1 });
  upsertRecord(db, { hakbun: 'B', area: '세특', subject: '통합과학1', body: 'm', bytes: 1 });
  upsertRecord(db, { hakbun: 'B', area: '세특', subject: '통합과학1', body: 'n', bytes: 1 });
  const srv = createApp(db).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const list = await (await fetch(`${base}/api/edits?group=3-4담임`)).json();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].hakbun, 'A');
  } finally { srv.close(); }
});
