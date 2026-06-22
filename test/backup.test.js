const test = require('node:test');
const assert = require('node:assert');
const { open, upsertStudent, upsertRecord, getStudent } = require('../src/db');
const { exportBackup, importBackup } = require('../src/backup');

function seed(db) {
  upsertStudent(db, { hakbun: '30401', name: '강하연', group_tag: '3-4담임' });
  upsertRecord(db, { hakbun: '30401', area: '자율', subject: '', body: '자율 본문', bytes: 12, status: '완료' });
}

test('백업 내보내기→불러오기 라운드트립', () => {
  const a = open(':memory:');
  seed(a);
  const env = exportBackup(a, 'pw1234');
  assert.strictEqual(env.magic, 'SBBAK01');
  assert.ok(env.salt && env.iv && env.tag && env.data);

  const b = open(':memory:');
  const res = importBackup(b, 'pw1234', env);
  assert.ok(res.ok);
  const s = getStudent(b, '30401');
  assert.strictEqual(s.name, '강하연');
  const rec = s.records.find((r) => r.area === '자율');
  assert.strictEqual(rec.body, '자율 본문');
  assert.strictEqual(rec.status, '완료');
});

test('틀린 비밀번호는 거부', () => {
  const a = open(':memory:');
  seed(a);
  const env = exportBackup(a, 'rightpw');
  const b = open(':memory:');
  assert.throws(() => importBackup(b, 'wrongpw', env), /비밀번호가 틀렸|손상/);
});

test('짧은 비밀번호 내보내기 거부', () => {
  const a = open(':memory:');
  seed(a);
  assert.throws(() => exportBackup(a, 'ab'), /4자 이상/);
});

test('불러오기는 기존 데이터를 백업으로 대체', () => {
  const a = open(':memory:');
  seed(a);
  const env = exportBackup(a, 'pw1234');
  const b = open(':memory:');
  upsertStudent(b, { hakbun: '39999', name: '삭제될학생', group_tag: '기타반' });
  importBackup(b, 'pw1234', env);
  assert.strictEqual(getStudent(b, '39999'), null);
  assert.ok(getStudent(b, '30401'));
});
