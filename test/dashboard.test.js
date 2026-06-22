const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, upsertRecord, dashboardData, areasForGroup } = require('../src/db');
const { createApp } = require('../src/server');

function freshDb() { return open(':memory:'); }

test('areasForGroup 그룹별 영역 결정', () => {
  const db = freshDb();
  assert.deepStrictEqual(areasForGroup(db, '3-4담임').map((a) => a.area), ['자율', '진로', '행특']);
  assert.deepStrictEqual(areasForGroup(db, '과학동아리'), [{ area: '동아리', subject: '과학동아리' }]);
  assert.deepStrictEqual(areasForGroup(db, '통합과학1'), [{ area: '세특', subject: '통합과학1' }]);
});

test('dashboardData 담임 요약/바이트/완료율', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'B', name: '나', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: '가나다', bytes: 9, status: '완료' });
  const d = dashboardData(db, '3-4담임');
  assert.strictEqual(d.rows.length, 2);
  assert.deepStrictEqual(d.areas, ['자율', '진로', '행특']);
  assert.strictEqual(d.totalCells, 6);
  assert.strictEqual(d.summary['완료'], 1);
  assert.strictEqual(d.summary['미작성'], 5);
  const cellA = d.rows.find((r) => r.hakbun === 'A').cells.find((c) => c.area === '자율');
  assert.strictEqual(cellA.bytes, 9);
  assert.ok(cellA.pct > 0);
});

test('dashboardData 세특은 subject=그룹명 매칭', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '통합과학1' });
  upsertRecord(db, { hakbun: 'A', area: '세특', subject: '통합과학1', body: 'x', bytes: 1, status: '초안' });
  const d = dashboardData(db, '통합과학1');
  assert.strictEqual(d.rows[0].cells[0].status, '초안');
});

test('GET /api/dashboard', async () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  const srv = createApp(db).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const d = await (await fetch(`${base}/api/dashboard?group=3-4담임`)).json();
    assert.strictEqual(d.group, '3-4담임');
    assert.strictEqual(d.rows.length, 1);
  } finally { srv.close(); }
});
