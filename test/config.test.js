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
