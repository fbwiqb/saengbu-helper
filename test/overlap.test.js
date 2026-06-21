const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, upsertRecord, overlapReport } = require('../src/db');

function freshDb() { return open(':memory:'); }

test('overlapReport 인용구/명사구 2명 이상만', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'B', name: '나', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'C', name: '다', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: "'환경보호 캠페인'에 참여하여 과학탐구활동을 했다", bytes: 1 });
  upsertRecord(db, { hakbun: 'B', area: '자율', subject: '', body: "'환경보호 캠페인'을 기획하고 과학탐구활동에 매진했다", bytes: 1 });
  upsertRecord(db, { hakbun: 'C', area: '자율', subject: '', body: '독자적인 내용만 작성한 학생', bytes: 1 });
  const o = overlapReport(db, '3-4담임');
  const camp = o.events.find((e) => e.term === '환경보호 캠페인');
  assert.ok(camp, '공유 인용구 검출');
  assert.strictEqual(camp.students.length, 2);
  const tamgu = o.events.find((e) => e.term === '과학탐구활동');
  assert.ok(tamgu, '공유 명사구 검출');
});

test('overlapReport 고유사도 쌍 0.3 이상', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  upsertStudent(db, { hakbun: 'B', name: '나', group_tag: '3-4담임' });
  const txt = '학급 회장으로서 책임감을 가지고 학급 행사를 주도적으로 기획하고 운영하였다';
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: txt, bytes: 1 });
  upsertRecord(db, { hakbun: 'B', area: '자율', subject: '', body: txt + ' 그리고 협력하였다', bytes: 1 });
  const o = overlapReport(db, '3-4담임');
  assert.strictEqual(o.similarPairs.length, 1);
  assert.ok(o.similarPairs[0].score >= 0.3);
  assert.strictEqual(o.similarPairs[0].area, '자율');
});

test('overlapReport 다른 영역은 유사도 비교 안 함', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: 'A', name: '가', group_tag: '3-4담임' });
  const txt = '동일한 내용을 서로 다른 영역에 작성한 경우를 테스트한다';
  upsertRecord(db, { hakbun: 'A', area: '자율', subject: '', body: txt, bytes: 1 });
  upsertRecord(db, { hakbun: 'A', area: '진로', subject: '', body: txt, bytes: 1 });
  const o = overlapReport(db, '3-4담임');
  assert.strictEqual(o.similarPairs.length, 0);
});
