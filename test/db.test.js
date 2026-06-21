const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, listStudents, getStudent,
        upsertRecord, saveLegacy, replaceBooks } = require('../src/db');

function freshDb() { return open(':memory:'); }

test('학생 upsert + 목록 + 조회', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: '30404', name: '홍길동', group_tag: '3-4담임', naesin: 5.96 });
  upsertStudent(db, { hakbun: '30404', name: '홍길동', group_tag: '3-4담임', naesin: 5.9 });
  const list = listStudents(db, '3-4담임');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].naesin, 5.9);
});

test('레코드 upsert는 영역+과목 유니크', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: '30404', name: '홍길동', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: '30404', area: '자율', subject: '', body: 'A', bytes: 1 });
  upsertRecord(db, { hakbun: '30404', area: '자율', subject: '', body: 'B', bytes: 1 });
  upsertRecord(db, { hakbun: '30404', area: '세특', subject: '통합과학1', body: 'C', bytes: 1 });
  const s = getStudent(db, '30404');
  assert.strictEqual(s.records.length, 2);
  assert.strictEqual(s.records.find(r => r.area === '자율').body, 'B');
});

test('NULL subject도 PRIMARY KEY로 묶임', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: '30404', name: '홍길동', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: '30404', area: '자율', subject: null, body: 'X', bytes: 1 });
  upsertRecord(db, { hakbun: '30404', area: '자율', subject: null, body: 'Y', bytes: 1 });
  const s = getStudent(db, '30404');
  assert.strictEqual(s.records.length, 1);
  assert.strictEqual(s.records[0].body, 'Y');
});

test('연계메모 + 독서 교체', () => {
  const db = freshDb();
  upsertStudent(db, { hakbun: '30404', name: '홍길동', group_tag: '3-4담임' });
  saveLegacy(db, { hakbun: '30404', dup_avoid: 'x', growth_link: 'y', gap_fill: 'z' });
  replaceBooks(db, '30404', '자율', '', [{ title: 'T', author: 'A' }]);
  const s = getStudent(db, '30404');
  assert.strictEqual(s.legacy.growth_link, 'y');
  assert.strictEqual(s.books.length, 1);
});
