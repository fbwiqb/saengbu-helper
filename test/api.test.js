const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { open, upsertStudent, studentKey } = require('../src/db');
const { createApp } = require('../src/server');
const kenc = (g, d) => encodeURIComponent(studentKey(g, d));

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
    await fetch(`${base}/api/records/${kenc('3-4담임', '30404')}/자율`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '가나다', status: '초안' }),
    });
    const s = await (await fetch(`${base}/api/students/${kenc('3-4담임', '30404')}`)).json();
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
    const put = await fetch(`${base}/api/records/${kenc('멘토링', '30401')}/${encodeURIComponent('기타')}?subject=${encodeURIComponent('멘토링')}`, {
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
    assert.strictEqual(damim[0].disp, '30401');
    const setuk = await (await fetch(`${base}/api/students?group=${encodeURIComponent('고급생명 1')}`)).json();
    assert.strictEqual(setuk[0].name, '강하연');
    assert.strictEqual(setuk[0].naesin, 5.15);
  });
});

test('마이그레이션: 옛 학번키 → 그룹별 분리, 레코드 정확 라우팅, 유실 0', () => {
  const tmp = path.join(os.tmpdir(), `saengbu_migtest_${process.pid}_${Math.random().toString(36).slice(2)}.db`);
  const cleanup = () => {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* */ } }
    try { for (const f of fs.readdirSync(path.dirname(tmp))) if (f.startsWith(`${path.basename(tmp)}.pre-v2-`)) fs.unlinkSync(path.join(path.dirname(tmp), f)); } catch (e) { /* */ }
  };
  try {
    let db = open(tmp);
    db.prepare("DELETE FROM app_config WHERE key='identity_v2'").run();
    db.prepare('INSERT OR IGNORE INTO groups (group_tag,category) VALUES (?,?)').run('3-4반', '담임');
    db.prepare('INSERT OR IGNORE INTO groups (group_tag,category) VALUES (?,?)').run('고급생명', '세특');
    db.prepare('INSERT INTO students (hakbun,name,group_tag,status) VALUES (?,?,?,?)').run('30401', '강하연', '3-4반', '초안');
    db.prepare('INSERT INTO memberships (hakbun,group_tag) VALUES (?,?)').run('30401', '3-4반');
    db.prepare('INSERT INTO memberships (hakbun,group_tag) VALUES (?,?)').run('30401', '고급생명');
    db.prepare('INSERT INTO records (hakbun,area,subject,body,bytes,status) VALUES (?,?,?,?,?,?)').run('30401', '자율', '', '자율내용', 6, '초안');
    db.prepare('INSERT INTO records (hakbun,area,subject,body,bytes,status) VALUES (?,?,?,?,?,?)').run('30401', '세특', '고급생명', '세특내용', 6, '초안');
    db.close();
    db = open(tmp);
    assert.strictEqual(db.prepare('SELECT name FROM students WHERE hakbun=?').get(studentKey('3-4반', '30401')).name, '강하연');
    assert.ok(db.prepare('SELECT 1 FROM students WHERE hakbun=?').get(studentKey('고급생명', '30401')));
    assert.strictEqual(db.prepare("SELECT body FROM records WHERE hakbun=? AND area='자율'").get(studentKey('3-4반', '30401')).body, '자율내용');
    assert.strictEqual(db.prepare("SELECT body FROM records WHERE hakbun=? AND area='세특'").get(studentKey('고급생명', '30401')).body, '세특내용');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM students WHERE instr(hakbun,char(31))=0').get().n, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM records').get().n, 2);
    db.close();
  } finally {
    cleanup();
  }
});

test('마이그레이션 엣지: 비멤버 subject 레코드·멤버십0 학생도 유실/고아 0', () => {
  const tmp = path.join(os.tmpdir(), `saengbu_migedge_${process.pid}_${Math.random().toString(36).slice(2)}.db`);
  const cleanup = () => {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) { try { fs.unlinkSync(f); } catch (e) { /* */ } }
    try { for (const f of fs.readdirSync(path.dirname(tmp))) if (f.startsWith(`${path.basename(tmp)}.pre-v2-`)) fs.unlinkSync(path.join(path.dirname(tmp), f)); } catch (e) { /* */ }
  };
  try {
    let db = open(tmp);
    db.prepare("DELETE FROM app_config WHERE key='identity_v2'").run();
    db.prepare('INSERT OR IGNORE INTO groups (group_tag,category) VALUES (?,?)').run('3-4반', '담임');
    db.prepare('INSERT INTO students (hakbun,name,group_tag) VALUES (?,?,?)').run('30401', '강하연', '3-4반');
    db.prepare('INSERT INTO memberships (hakbun,group_tag) VALUES (?,?)').run('30401', '3-4반');
    db.prepare('INSERT INTO records (hakbun,area,subject,body,bytes) VALUES (?,?,?,?,?)').run('30401', '세특', '옛세특', '비멤버', 6);
    db.prepare('INSERT INTO students (hakbun,name) VALUES (?,?)').run('30402', '권다은');
    db.prepare('INSERT INTO records (hakbun,area,subject,body,bytes) VALUES (?,?,?,?,?)').run('30402', '자율', '', '고립', 6);
    db.close();
    db = open(tmp);
    const orphan = db.prepare('SELECT COUNT(*) n FROM records r WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.hakbun=r.hakbun)').get().n;
    assert.strictEqual(orphan, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM records').get().n, 2);
    assert.ok(db.prepare('SELECT 1 FROM records WHERE body=?').get('고립'));
    db.close();
  } finally {
    cleanup();
  }
});
