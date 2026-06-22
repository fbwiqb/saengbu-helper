const test = require('node:test');
const assert = require('node:assert');
const db_ = require('../src/db');
const { open, getAreasConfig, setAreasConfig, upsertGroup, getCategory, areasForGroup, limitFor, bulkAddStudents, listStudents, listGroupsDetailed } = db_;

function freshDb() { return open(':memory:'); }

test('기본 config 시드 — 창체 1500 행특 900 세특 1500', () => {
  const db = freshDb();
  const cfg = getAreasConfig(db);
  assert.strictEqual(cfg['담임'].find((a) => a.area === '자율').limit, 1500);
  assert.strictEqual(cfg['담임'].find((a) => a.area === '진로').limit, 1500);
  assert.strictEqual(cfg['담임'].find((a) => a.area === '행특').limit, 900);
  assert.strictEqual(cfg['세특'][0].limit, 1500);
  assert.strictEqual(cfg['동아리'][0].limit, 1500);
});

test('setAreasConfig — 한도 변경 + 잘못된 항목 정리', () => {
  const db = freshDb();
  const saved = setAreasConfig(db, {
    담임: [{ area: '자율', limit: 1500 }, { area: '행특', limit: 750 }, { area: '', limit: 100 }],
    세특: [{ area: '세특', limit: 1500 }],
    동아리: [{ area: '동아리', limit: 1500 }],
    기타: [{ area: '봉사', limit: 0 }],
  });
  assert.strictEqual(saved['담임'].length, 2);
  assert.strictEqual(saved['담임'].find((a) => a.area === '행특').limit, 750);
  assert.strictEqual(saved['기타'].length, 0);
  assert.strictEqual(limitFor(db, '행특'), 750);
});

test('upsertGroup + getCategory + areasForGroup 데이터 기반', () => {
  const db = freshDb();
  upsertGroup(db, '나의화학', '세특');
  assert.strictEqual(getCategory(db, '나의화학'), '세특');
  assert.deepStrictEqual(areasForGroup(db, '나의화학'), [{ area: '세특', subject: '나의화학' }]);
  upsertGroup(db, '우리반', '담임');
  assert.deepStrictEqual(areasForGroup(db, '우리반').map((a) => a.area), ['자율', '진로', '행특']);
});

test('bulkAddStudents — 한글 컬럼 매핑 + 그룹 카테고리 등록', () => {
  const db = freshDb();
  const added = bulkAddStudents(db, '3-1물리', '세특', [
    { 학번: '30101', 이름: '김가', 번호: 1, 성별: '남', 내신: 2.5, 전형: '농어촌' },
    { 학번: '30102', 이름: '이나' },
    { 학번: '', 이름: '무시됨' },
  ]);
  assert.strictEqual(added, 2);
  assert.strictEqual(getCategory(db, '3-1물리'), '세특');
  const list = listStudents(db, '3-1물리');
  assert.strictEqual(list.length, 2);
  const a = list.find((s) => s.hakbun === '30101');
  assert.strictEqual(a.name, '김가');
  assert.strictEqual(a.naesin, 2.5);
  assert.strictEqual(a.jeonhyeong, '농어촌');
});

test('listGroupsDetailed — 카테고리+인원', () => {
  const db = freshDb();
  bulkAddStudents(db, '3-1물리', '세특', [{ 학번: '1', 이름: '가' }, { 학번: '2', 이름: '나' }]);
  const rows = listGroupsDetailed(db);
  const g = rows.find((r) => r.group_tag === '3-1물리');
  assert.strictEqual(g.category, '세특');
  assert.strictEqual(g.n, 2);
});

test('removeMembership — 마지막 그룹이라도 내용 있으면 학생·기록 보존', () => {
  const db = freshDb();
  bulkAddStudents(db, '고급생명 01', '세특', [{ 학번: '30401', 이름: '강하연' }]);
  db_.upsertRecord(db, { hakbun: '30401', area: '세특', subject: '고급생명 01', body: '직접 실험 설계함', bytes: 20, status: '완료' });
  db_.removeMembership(db, '30401', '고급생명 01');
  const s = db.prepare('SELECT 1 FROM students WHERE hakbun=?').get('30401');
  const rec = db.prepare("SELECT body FROM records WHERE hakbun='30401' AND area='세특'").get();
  assert.ok(s, '학생 보존');
  assert.ok(rec && rec.body.includes('실험'), '본문 보존');
});

test('removeMembership — 빈 기록·마지막 그룹이면 학생 정리', () => {
  const db = freshDb();
  bulkAddStudents(db, '고급생명 01', '세특', [{ 학번: '30402', 이름: '성춘향' }]);
  db_.removeMembership(db, '30402', '고급생명 01');
  assert.ok(!db.prepare('SELECT 1 FROM students WHERE hakbun=?').get('30402'), '빈 학생 삭제');
});

test('config에서 영역 제거해도 작성된 본문은 prune되지 않음', () => {
  const db = freshDb();
  bulkAddStudents(db, '3-4담임', '담임', [{ 학번: '30401', 이름: '강하연' }, { 학번: '30406', 이름: '김민우' }]);
  db_.upsertRecord(db, { hakbun: '30401', area: '행특', subject: '', body: '행특 본문', bytes: 12, status: '완료' });
  setAreasConfig(db, { 담임: [{ area: '자율', limit: 1500 }, { area: '진로', limit: 1500 }], 세특: [{ area: '세특', limit: 1500 }], 동아리: [{ area: '동아리', limit: 1500 }], 기타: [] });
  db_.removeMembership(db, '30406', '3-4담임'); // 무관한 멤버십 변동 → prune 유발
  const rec = db.prepare("SELECT body FROM records WHERE hakbun='30401' AND area='행특'").get();
  assert.ok(rec && rec.body === '행특 본문', '제거된 영역 본문 보존');
});

test('upsertGroup — 기존 그룹 분류 유지(플립 금지)', () => {
  const db = freshDb();
  upsertGroup(db, 'G', '동아리');
  assert.strictEqual(upsertGroup(db, 'G', '담임'), '동아리');
  assert.strictEqual(getCategory(db, 'G'), '동아리');
});

test('deleteGroup — 명시 삭제는 그 그룹 기록 제거, 타 그룹 기록 보존', () => {
  const db = freshDb();
  bulkAddStudents(db, '3-4담임', '담임', [{ 학번: '30401', 이름: '강하연' }]);
  bulkAddStudents(db, '고급생명 01', '세특', [{ 학번: '30401', 이름: '강하연' }]);
  db_.upsertRecord(db, { hakbun: '30401', area: '자율', subject: '', body: '자율본문', bytes: 12, status: '완료' });
  db_.upsertRecord(db, { hakbun: '30401', area: '세특', subject: '고급생명 01', body: '세특본문', bytes: 12, status: '완료' });
  db_.deleteGroup(db, '3-4담임');
  assert.ok(db.prepare('SELECT 1 FROM students WHERE hakbun=?').get('30401'), '학생 보존(세특 소속)');
  assert.ok(!db.prepare("SELECT 1 FROM records WHERE hakbun='30401' AND area='자율'").get(), '담임 자율 삭제');
  assert.ok(db.prepare("SELECT 1 FROM records WHERE hakbun='30401' AND area='세특'").get(), '세특 보존');
});
