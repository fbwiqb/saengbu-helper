const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db_ = require('../src/db');
const { calcBytes } = require('../src/bytes');
const backup = require('../src/backup');

function student(db, group, id, budget = {}) {
  db_.upsertGroup(db, group, '세특');
  const hakbun = db_.studentKey(group, id);
  db_.upsertStudent(db, { hakbun, name: '테스트', group_tag: group, ...budget });
  return hakbun;
}

test('individual limits override group defaults and reset without altering records', () => {
  const db = db_.open(':memory:');
  const hakbun = student(db, '과학13', '10101', { byte_limit: 689, required_prefix: '(2학기) ' });
  db_.setGroupByte(db, '과학13', 750);
  db_.upsertRecord(db, { hakbun, area: '세특', subject: '과학13', body: '탐구', bytes: 6, status: '완료' });
  const records = db.prepare('SELECT * FROM records').all();
  assert.equal(db_.dashboardData(db, '과학13').rows[0].cells[0].limit, 689);
  assert.equal(db_.allRecords(db)[0].limit, 689);
  db_.upsertStudent(db, { hakbun, byte_limit: null });
  assert.equal(db_.dashboardData(db, '과학13').rows[0].cells[0].limit, 750);
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), records);
  assert.equal(calcBytes(db_.getStudent(db, hakbun).required_prefix), 10);
  db.close();
});

test('roster reimport preserves caps and imports optional numeric and prefix fields', () => {
  const db = db_.open(':memory:');
  db_.bulkAddStudents(db, '과학13', '세특', [{ hakbun: '10101', name: '가', byte_limit: '880', required_prefix: '(2학기) ', neis_existing_bytes: '0' }]);
  db_.bulkAddStudents(db, '과학13', '세특', [{ hakbun: '10101', name: '수정이름' }]);
  const s = db_.getStudent(db, db_.studentKey('과학13', '10101'));
  assert.equal(s.byte_limit, 880);
  assert.equal(s.required_prefix, '(2학기) ');
  assert.equal(s.name, '수정이름');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n, 0);
  db.close();
});

test('invalid cap rolls back an entire roster group', () => {
  const db = db_.open(':memory:');
  for (const bad of [0, -1, 3.5, 30001, true, 'oops']) {
    assert.throws(() => db_.bulkAddStudents(db, '오류그룹', '세특', [{ hakbun: '1', name: '가', byte_limit: 750 }, { hakbun: '2', name: '나', byte_limit: bad }]));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM students').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM groups').get().n, 0);
  }
  assert.throws(() => student(db, '과학', '1', { byte_limit: 5, required_prefix: '(2학기) ' }));
  db.close();
});

test('homeroom limits are independent of subject caps', () => {
  const db = db_.open(':memory:');
  db_.upsertGroup(db, '담임', '담임');
  db_.upsertStudent(db, { hakbun: '1', group_tag: '담임', byte_limit: 600 });
  assert.equal(db_.limitForGroup(db, '담임', '자율', '1'), 1500);
  db.close();
});

test('global totals count effective text, newlines, and career hope; hiding moves bytes between buckets', () => {
  const db = db_.open(':memory:');
  const active = student(db, '현재', '1');
  const hidden = student(db, '이전', '1');
  db_.setGroupHidden(db, '이전', true);
  db_.upsertRecord(db, { hakbun: active, area: '세특', subject: '현재', body: '가\n나', bytes: 999, status: '완료' });
  db_.upsertRecord(db, { hakbun: hidden, area: '세특', subject: '이전', body: '과거', revised: '수정문', bytes: 999 });
  db_.upsertGroup(db, '담임', '담임');
  db_.upsertStudent(db, { hakbun: '담임학생', group_tag: '담임' });
  db_.upsertRecord(db, { hakbun: '담임학생', area: '진로', body: '진로', bytes: 6, hope_field: ' 자연과학 ' });
  let totals = db_.dashboardTotals(db);
  assert.equal(totals.active.bytes, 8 + 6 + 12);
  assert.equal(totals.hidden.bytes, 9);
  assert.equal(totals.total.bytes, 35);
  assert.equal(totals.total.records, 3);
  assert.equal(db_.dashboardData(db, '현재').rows[0].cells[0].bytes, 8);
  const before = db.prepare('SELECT * FROM records').all();
  db_.setGroupHidden(db, '현재', true);
  totals = db_.dashboardTotals(db);
  assert.equal(totals.total.bytes, 35);
  assert.equal(totals.active.bytes, 18);
  assert.equal(totals.hidden.bytes, 17);
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before);
  db.close();
});

test('shared membership is counted once and any active owner keeps the record active', () => {
  const db = db_.open(':memory:');
  db_.upsertGroup(db, '원담임', '담임');
  db_.upsertGroup(db, '추가담임', '담임');
  db_.upsertStudent(db, { hakbun: '1', group_tag: '원담임' });
  db.prepare('INSERT INTO memberships VALUES (?,?)').run('1', '추가담임');
  db_.setGroupHidden(db, '원담임', true);
  db_.upsertRecord(db, { hakbun: '1', area: '자율', body: '가', bytes: 3 });
  assert.equal(db_.dashboardTotals(db).total.bytes, 3);
  assert.equal(db_.dashboardTotals(db).active.bytes, 3);
  db_.setGroupHidden(db, '추가담임', true);
  assert.equal(db_.dashboardTotals(db).hidden.bytes, 3);
  db.close();
});

test('empty state and unassigned records still reconcile', () => {
  const db = db_.open(':memory:');
  assert.equal(db_.dashboardTotals(db).total.bytes, 0);
  db_.upsertRecord(db, { hakbun: 'legacy', area: '세특', body: '가', bytes: 3 });
  const totals = db_.dashboardTotals(db);
  assert.equal(totals.total.bytes, 3);
  assert.equal(totals.total.bytes, totals.active.bytes + totals.hidden.bytes);
  db.close();
});

test('student budget survives restart and encrypted backup roundtrip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saengbu-budget-'));
  const file = path.join(dir, 'test.db');
  let db = db_.open(file);
  const hakbun = student(db, '과학', '1', { byte_limit: 754, required_prefix: '(2학기) ', neis_existing_bytes: 0 });
  const envelope = backup.exportBackup(db, 'test-password');
  db.close();
  db = db_.open(file);
  assert.equal(db_.getStudent(db, hakbun).byte_limit, 754);
  const restored = db_.open(':memory:');
  backup.importBackup(restored, 'test-password', envelope);
  assert.equal(db_.getStudent(restored, hakbun).required_prefix, '(2학기) ');
  assert.equal(db_.getStudent(restored, hakbun).byte_limit, 754);
  db.close(); restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('group prefix checkbox updates metadata only and is inherited by new students', () => {
  const db = db_.open(':memory:');
  const hakbun = student(db, '과학', '1', { byte_limit: 754 });
  db_.upsertRecord(db, { hakbun, area: '세특', subject: '과학', body: '기존 본문', bytes: 13, status: '완료' });
  const before = db.prepare('SELECT * FROM records').all();
  db_.setGroupPrefix(db, '과학', true);
  assert.equal(db_.getStudent(db, hakbun).required_prefix, '(2학기) ');
  const added = student(db, '과학', '2');
  assert.equal(db_.getStudent(db, added).required_prefix, '(2학기) ');
  assert.equal(db_.listGroupsDetailed(db)[0].prefix_count, 2);
  db_.setGroupPrefix(db, '과학', false);
  assert.equal(db_.getStudent(db, added).required_prefix, null);
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before);
  db.close();
});

test('group prefix rejects too-small individual limits without partial application', () => {
  const db = db_.open(':memory:');
  student(db, '과학', '1', { byte_limit: 754 });
  const small = student(db, '과학', '2', { byte_limit: 5 });
  assert.throws(() => db_.setGroupPrefix(db, '과학', true));
  assert.equal(db_.getStudent(db, small).required_prefix, null);
  assert.equal(db_.listGroupsDetailed(db)[0].required_prefix, null);
  db.close();
});
