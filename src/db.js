const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  hakbun TEXT PRIMARY KEY, name TEXT, group_tag TEXT,
  ban TEXT, beonho INTEGER, gender TEXT, naesin REAL, jeonhyeong TEXT,
  status TEXT DEFAULT '미작성',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memberships (
  hakbun TEXT, group_tag TEXT,
  PRIMARY KEY (hakbun, group_tag)
);
CREATE TABLE IF NOT EXISTS records (
  hakbun TEXT, area TEXT, subject TEXT DEFAULT '',
  body TEXT DEFAULT '', revised TEXT DEFAULT '', reason TEXT DEFAULT '',
  bytes INTEGER DEFAULT 0, status TEXT DEFAULT '미작성',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (hakbun, area, subject)
);
CREATE TABLE IF NOT EXISTS legacy (
  hakbun TEXT PRIMARY KEY, dup_avoid TEXT DEFAULT '',
  growth_link TEXT DEFAULT '', gap_fill TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS books (
  hakbun TEXT, area TEXT, subject TEXT DEFAULT '', title TEXT, author TEXT
);
CREATE TABLE IF NOT EXISTS edits_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hakbun TEXT, area TEXT, subject TEXT DEFAULT '',
  before TEXT DEFAULT '', after TEXT DEFAULT '', reason TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exemplars_added (
  hakbun TEXT, area TEXT, subject TEXT DEFAULT '',
  text TEXT DEFAULT '', added_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY, value TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS groups (
  group_tag TEXT PRIMARY KEY, category TEXT DEFAULT '기타',
  created_at TEXT DEFAULT (datetime('now'))
);
`;

const CATEGORIES = ['담임', '세특', '동아리', '기타'];
const PER_SUBJECT_CATEGORIES = new Set(['세특', '동아리', '기타']);

const DEFAULT_AREAS_CONFIG = {
  담임: [
    { area: '자율', limit: 1500 },
    { area: '진로', limit: 1500 },
    { area: '행특', limit: 900 },
  ],
  세특: [{ area: '세특', limit: 1500 }],
  동아리: [{ area: '동아리', limit: 1500 }],
  기타: [],
};

const RECORD_COLUMNS = [
  ['q_exp', 'INTEGER DEFAULT NULL'],
  ['q_think', 'INTEGER DEFAULT NULL'],
  ['q_growth', 'INTEGER DEFAULT NULL'],
  ['q_authentic', 'INTEGER DEFAULT NULL'],
  ['accepted', 'INTEGER DEFAULT 0'],
];

function migrateRecords(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(records)').all().map((c) => c.name));
  for (const [name, def] of RECORD_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE records ADD COLUMN ${name} ${def}`);
  }
}

function inferCategory(name) {
  const g = String(name || '');
  if (g.includes('담임')) return '담임';
  if (g.includes('동아리')) return '동아리';
  if (g.includes('세특')) return '세특';
  return '세특';
}

function backfillGroups(db) {
  const tagged = db.prepare('SELECT DISTINCT group_tag FROM memberships').all();
  const ins = db.prepare('INSERT OR IGNORE INTO groups (group_tag, category) VALUES (?, ?)');
  for (const { group_tag } of tagged) ins.run(group_tag, inferCategory(group_tag));
}

function seedConfig(db) {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get('areas_config');
  if (!row) {
    db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)')
      .run('areas_config', JSON.stringify(DEFAULT_AREAS_CONFIG));
  }
}

function migrateGroups(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(groups)').all().map((c) => c.name));
  if (!cols.has('byte_limit')) db.exec('ALTER TABLE groups ADD COLUMN byte_limit INTEGER');
}

function open(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrateRecords(db);
  migrateGroups(db);
  seedConfig(db);
  backfillGroups(db);
  return db;
}

function getAreasConfig(db) {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get('areas_config');
  if (!row) return { ...DEFAULT_AREAS_CONFIG };
  try {
    return JSON.parse(row.value);
  } catch {
    return { ...DEFAULT_AREAS_CONFIG };
  }
}

function setAreasConfig(db, config) {
  const clean = {};
  for (const cat of CATEGORIES) {
    const list = Array.isArray(config[cat]) ? config[cat] : [];
    clean[cat] = list
      .filter((a) => a && a.area)
      .map((a) => ({ area: String(a.area).trim(), limit: Number(a.limit) || 0 }))
      .filter((a) => a.area && a.limit > 0);
  }
  db.prepare(`INSERT INTO app_config (key, value) VALUES ('areas_config', @v)
    ON CONFLICT(key) DO UPDATE SET value=@v`).run({ v: JSON.stringify(clean) });
  return clean;
}

function getSpellIgnore(db) {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get('spell_ignore');
  if (!row) return [];
  try { const a = JSON.parse(row.value); return Array.isArray(a) ? a : []; } catch { return []; }
}

function saveSpellIgnore(db, arr) {
  const clean = [...new Set((Array.isArray(arr) ? arr : []).map((w) => String(w || '').trim()).filter(Boolean))];
  db.prepare(`INSERT INTO app_config (key, value) VALUES ('spell_ignore', @v)
    ON CONFLICT(key) DO UPDATE SET value=@v`).run({ v: JSON.stringify(clean) });
  return clean;
}

function addSpellIgnore(db, word) {
  return saveSpellIgnore(db, [...getSpellIgnore(db), word]);
}

function getCategory(db, group) {
  const row = db.prepare('SELECT category FROM groups WHERE group_tag=?').get(group);
  return row ? row.category : inferCategory(group);
}

function upsertGroup(db, group, category) {
  const existing = db.prepare('SELECT category FROM groups WHERE group_tag=?').get(group);
  if (existing) return existing.category;
  const cat = CATEGORIES.includes(category) ? category : inferCategory(group);
  db.prepare('INSERT INTO groups (group_tag, category) VALUES (?, ?)').run(group, cat);
  return cat;
}

function listGroupsDetailed(db) {
  return db.prepare(`SELECT g.group_tag, g.category, g.byte_limit,
      (SELECT COUNT(*) FROM memberships m WHERE m.group_tag=g.group_tag) n
    FROM groups g ORDER BY g.category, g.group_tag`).all();
}

function setGroupByte(db, tag, limit) {
  const v = (limit == null || limit === '') ? null : (Number(limit) || null);
  db.prepare('UPDATE groups SET byte_limit=? WHERE group_tag=?').run(v, tag);
  return v;
}

function limitForGroup(db, group, area) {
  const row = db.prepare('SELECT category, byte_limit FROM groups WHERE group_tag=?').get(group);
  if (row && row.byte_limit && PER_SUBJECT_CATEGORIES.has(row.category)) return row.byte_limit;
  return limitFor(db, area);
}

function isEmptyRec(r) {
  return !((r.body || '').trim() || (r.revised || '').trim() || (r.reason || '').trim());
}

function coveredAreas(db, hakbun, excludeTag) {
  const groups = db.prepare('SELECT group_tag FROM memberships WHERE hakbun=?').all(hakbun)
    .map((r) => r.group_tag).filter((g) => g !== excludeTag);
  const valid = new Set();
  for (const g of groups) for (const a of areasForGroup(db, g)) valid.add(`${a.area}|${a.subject || ''}`);
  return { groups, valid };
}

// SAFE prune: only delete EMPTY uncovered placeholder records. Never delete content. Never auto-delete a student that still has any record.
function pruneStudent(db, hakbun) {
  const { groups, valid } = coveredAreas(db, hakbun, null);
  for (const r of db.prepare('SELECT area,subject,body,revised,reason FROM records WHERE hakbun=?').all(hakbun)) {
    const key = `${r.area}|${r.subject || ''}`;
    if (valid.has(key) || !isEmptyRec(r)) continue;
    const books = db.prepare('SELECT COUNT(*) n FROM books WHERE hakbun=? AND area=? AND subject=?').get(hakbun, r.area, r.subject || '').n;
    if (books) continue;
    db.prepare('DELETE FROM records WHERE hakbun=? AND area=? AND subject=?').run(hakbun, r.area, r.subject || '');
  }
  if (!groups.length) {
    const recN = db.prepare('SELECT COUNT(*) n FROM records WHERE hakbun=?').get(hakbun).n;
    const bookN = db.prepare('SELECT COUNT(*) n FROM books WHERE hakbun=?').get(hakbun).n;
    if (!recN && !bookN) deleteStudent(db, hakbun);
  }
}

// Explicit, user-confirmed: deletes THIS group's own area-records that no remaining group covers.
function deleteGroup(db, tag) {
  const areas = areasForGroup(db, tag);
  const members = db.prepare('SELECT hakbun FROM memberships WHERE group_tag=?').all(tag).map((r) => r.hakbun);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM groups WHERE group_tag=?').run(tag);
    db.prepare('DELETE FROM memberships WHERE group_tag=?').run(tag);
    for (const hakbun of members) {
      const { groups, valid } = coveredAreas(db, hakbun, null);
      for (const a of areas) {
        const key = `${a.area}|${a.subject || ''}`;
        if (valid.has(key)) continue;
        db.prepare('DELETE FROM records WHERE hakbun=? AND area=? AND subject=?').run(hakbun, a.area, a.subject || '');
        db.prepare('DELETE FROM books WHERE hakbun=? AND area=? AND subject=?').run(hakbun, a.area, a.subject || '');
      }
      if (!groups.length) {
        const recN = db.prepare('SELECT COUNT(*) n FROM records WHERE hakbun=?').get(hakbun).n;
        if (!recN) deleteStudent(db, hakbun);
      }
    }
  });
  tx();
  return { removedMembers: members.length };
}

function removeMembership(db, hakbun, tag) {
  db.prepare('DELETE FROM memberships WHERE hakbun=? AND group_tag=?').run(hakbun, tag);
  pruneStudent(db, hakbun);
}

function renameGroup(db, oldTag, newTag) {
  newTag = String(newTag || '').trim();
  if (!newTag || oldTag === newTag) return getCategory(db, oldTag);
  if (db.prepare('SELECT 1 FROM groups WHERE group_tag=?').get(newTag)) throw new Error('이미 있는 그룹명입니다');
  const cat = getCategory(db, oldTag);
  const perSubject = PER_SUBJECT_CATEGORIES.has(cat);
  const tx = db.transaction(() => {
    db.prepare('UPDATE groups SET group_tag=? WHERE group_tag=?').run(newTag, oldTag);
    db.prepare('UPDATE memberships SET group_tag=? WHERE group_tag=?').run(newTag, oldTag);
    if (perSubject) {
      for (const t of ['records', 'books', 'edits_log', 'exemplars_added']) {
        db.prepare(`UPDATE ${t} SET subject=? WHERE subject=?`).run(newTag, oldTag);
      }
    }
  });
  tx();
  return cat;
}

function limitFor(db, area) {
  const cfg = getAreasConfig(db);
  for (const cat of CATEGORIES) {
    const found = (cfg[cat] || []).find((a) => a.area === area);
    if (found) return found.limit;
  }
  return require('./bytes').TARGETS[area] || 0;
}

function upsertStudent(db, s) {
  db.prepare(`INSERT INTO students (hakbun,name,group_tag,ban,beonho,gender,naesin,jeonhyeong,status)
    VALUES (@hakbun,@name,@group_tag,@ban,@beonho,@gender,@naesin,@jeonhyeong,COALESCE(@status,'미작성'))
    ON CONFLICT(hakbun) DO UPDATE SET name=COALESCE(excluded.name, students.name),
      group_tag=COALESCE(excluded.group_tag, students.group_tag),
      ban=COALESCE(excluded.ban, students.ban), beonho=COALESCE(excluded.beonho, students.beonho),
      gender=COALESCE(excluded.gender, students.gender), naesin=COALESCE(excluded.naesin, students.naesin),
      jeonhyeong=COALESCE(excluded.jeonhyeong, students.jeonhyeong), updated_at=datetime('now')`)
    .run({ name: null, group_tag: null, ban: null, beonho: null, gender: null, naesin: null, jeonhyeong: null, status: null, ...s });
  if (s.group_tag) {
    db.prepare('INSERT OR IGNORE INTO memberships (hakbun, group_tag) VALUES (?, ?)').run(s.hakbun, s.group_tag);
  }
}

function listStudents(db, group) {
  const rows = group
    ? db.prepare('SELECT s.* FROM students s JOIN memberships m ON s.hakbun=m.hakbun WHERE m.group_tag=? ORDER BY s.hakbun').all(group)
    : db.prepare('SELECT * FROM students ORDER BY hakbun').all();
  if (group) {
    const areas = areasForGroup(db, group);
    const total = areas.length;
    for (const s of rows) {
      const recs = db.prepare('SELECT area,subject,status,bytes FROM records WHERE hakbun=?').all(s.hakbun);
      let done = 0; let started = 0;
      for (const { area, subject } of areas) {
        const rec = recs.find((r) => r.area === area && (r.subject || '') === (subject || ''));
        if (rec && rec.status === '완료') done += 1;
        if (rec && (rec.bytes > 0 || (rec.status && rec.status !== '미작성'))) started += 1;
      }
      s.prog = { done, started, total };
    }
  }
  return rows;
}

function listGroups(db) {
  return db.prepare('SELECT group_tag, COUNT(*) n FROM memberships GROUP BY group_tag ORDER BY group_tag').all();
}

function getStudent(db, hakbun) {
  const student = db.prepare('SELECT * FROM students WHERE hakbun=?').get(hakbun);
  if (!student) return null;
  student.records = db.prepare('SELECT * FROM records WHERE hakbun=? ORDER BY area,subject').all(hakbun);
  student.books = db.prepare('SELECT * FROM books WHERE hakbun=?').all(hakbun);
  student.groups = db.prepare('SELECT group_tag FROM memberships WHERE hakbun=? ORDER BY group_tag').all(hakbun).map((r) => r.group_tag);
  return student;
}

function upsertRecord(db, r) {
  const params = {
    subject: '', body: '', revised: '', reason: '', bytes: 0, status: '초안',
    q_exp: null, q_think: null, q_growth: null, q_authentic: null, accepted: 0, ...r,
  };
  params.subject = params.subject == null ? '' : params.subject;
  if (!params.subject) {
    const groups = db.prepare('SELECT group_tag FROM memberships WHERE hakbun=?').all(params.hakbun).map((m) => m.group_tag);
    const matches = groups.filter((g) => PER_SUBJECT_CATEGORIES.has(getCategory(db, g)) && areasForGroup(db, g).some((a) => a.area === params.area));
    if (matches.length === 1) params.subject = matches[0];
  }
  const prev = db.prepare('SELECT body, revised FROM records WHERE hakbun=? AND area=? AND subject=?')
    .get(params.hakbun, params.area, params.subject);
  const prevText = prev ? (prev.revised || prev.body || '') : '';
  const newText = params.revised || params.body || '';
  if (prev && prevText !== newText) {
    db.prepare(`INSERT INTO edits_log (hakbun,area,subject,before,after,reason,created_at)
      VALUES (?,?,?,?,?,?,datetime('now'))`)
      .run(params.hakbun, params.area, params.subject, prevText, newText, params.reason || '');
  }
  db.prepare(`INSERT INTO records (hakbun,area,subject,body,revised,reason,bytes,status,q_exp,q_think,q_growth,q_authentic,accepted,updated_at)
    VALUES (@hakbun,@area,@subject,@body,@revised,@reason,@bytes,@status,@q_exp,@q_think,@q_growth,@q_authentic,@accepted,datetime('now'))
    ON CONFLICT(hakbun,area,subject) DO UPDATE SET body=excluded.body, revised=excluded.revised,
      reason=excluded.reason, bytes=excluded.bytes, status=excluded.status,
      q_exp=excluded.q_exp, q_think=excluded.q_think, q_growth=excluded.q_growth,
      q_authentic=excluded.q_authentic, accepted=excluded.accepted, updated_at=datetime('now')`)
    .run(params);
}

function replaceBooks(db, hakbun, area, subject, books) {
  db.prepare('DELETE FROM books WHERE hakbun=? AND area=? AND subject=?').run(hakbun, area, subject || '');
  const ins = db.prepare('INSERT INTO books (hakbun,area,subject,title,author) VALUES (?,?,?,?,?)');
  for (const b of books) ins.run(hakbun, area, subject || '', b.title, b.author);
}

function deleteStudent(db, hakbun) {
  db.prepare('DELETE FROM students WHERE hakbun=?').run(hakbun);
  db.prepare('DELETE FROM memberships WHERE hakbun=?').run(hakbun);
  db.prepare('DELETE FROM records WHERE hakbun=?').run(hakbun);
  db.prepare('DELETE FROM legacy WHERE hakbun=?').run(hakbun);
  db.prepare('DELETE FROM books WHERE hakbun=?').run(hakbun);
}

function areasForGroup(db, group) {
  const cat = getCategory(db, group);
  const cfg = getAreasConfig(db);
  const list = cfg[cat] || [];
  const perSubject = PER_SUBJECT_CATEGORIES.has(cat);
  return list.map((a) => ({ area: a.area, subject: perSubject ? String(group || '') : '' }));
}

function statusBytes(db, group, rec, area) {
  const limit = limitForGroup(db, group, area);
  const bytes = rec ? (rec.bytes || 0) : 0;
  const pct = limit ? Math.round((bytes / limit) * 1000) / 10 : 0;
  return { bytes, pct, limit };
}

function dashboardData(db, group) {
  const students = listStudents(db, group);
  const areas = areasForGroup(db, group);
  const summary = { 미작성: 0, 초안: 0, 검증: 0, 완료: 0 };
  const rows = students.map((s) => {
    const recs = db.prepare('SELECT * FROM records WHERE hakbun=?').all(s.hakbun);
    const cells = areas.map(({ area, subject }) => {
      const rec = recs.find((r) => r.area === area && r.subject === subject);
      const status = rec ? (rec.status || '미작성') : '미작성';
      const { bytes, pct, limit } = statusBytes(db, group, rec, area);
      if (summary[status] !== undefined) summary[status] += 1;
      return { area, subject, status, bytes, pct, limit, body: rec ? (rec.revised || rec.body || '') : '' };
    });
    return { hakbun: s.hakbun, name: s.name, cells };
  });
  const totalCells = rows.length * areas.length;
  const completion = totalCells ? Math.round((summary['완료'] / totalCells) * 1000) / 10 : 0;
  return { group, areas: areas.map((a) => a.area), rows, summary, totalCells, completion };
}

function editsFor(db, hakbun, area, subject) {
  return db.prepare('SELECT * FROM edits_log WHERE hakbun=? AND area=? AND subject=? ORDER BY id ASC')
    .all(hakbun, area, subject || '');
}

function qualityStats(db, group) {
  const students = listStudents(db, group);
  const hakbuns = new Set(students.map((s) => s.hakbun));
  const groupFilter = group ? new Set(areasForGroup(db, group).map((a) => `${a.area} ${a.subject || ''}`)) : null;
  const byArea = new Map();
  for (const h of hakbuns) {
    for (const r of db.prepare('SELECT * FROM records WHERE hakbun=?').all(h)) {
      const subject = r.subject || '';
      const key = `${r.area} ${subject}`;
      if (groupFilter && !groupFilter.has(key)) continue;
      if (!byArea.has(key)) byArea.set(key, { area: r.area, subject, list: [] });
      byArea.get(key).list.push(r);
    }
  }
  const out = [];
  for (const { area, subject, list } of byArea.values()) {
    const avg = (key) => {
      const vals = list.map((r) => r[key]).filter((v) => v != null);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
    };
    const acceptedCount = list.filter((r) => r.accepted).length;
    out.push({
      area, subject, n: list.length,
      q_exp: avg('q_exp'), q_think: avg('q_think'), q_growth: avg('q_growth'), q_authentic: avg('q_authentic'),
      acceptRate: list.length ? Math.round((acceptedCount / list.length) * 1000) / 10 : 0,
    });
  }
  out.sort((a, b) => a.area.localeCompare(b.area) || a.subject.localeCompare(b.subject));
  return out;
}

function bulkAddStudents(db, group, category, rows) {
  upsertGroup(db, group, category);
  const tx = db.transaction((list) => {
    let added = 0;
    for (const r of list) {
      const hakbun = String(r.hakbun || r['학번'] || '').trim();
      if (!hakbun) continue;
      upsertStudent(db, {
        hakbun,
        name: String(r.name || r['이름'] || '').trim() || null,
        group_tag: group,
        ban: r.ban != null ? String(r.ban) : (r['반'] != null ? String(r['반']) : null),
        beonho: r.beonho != null ? Number(r.beonho) : (r['번호'] != null ? Number(r['번호']) : null),
        gender: r.gender || r['성별'] || null,
        naesin: r.naesin != null ? Number(r.naesin) : (r['내신'] != null ? Number(r['내신']) : null),
        jeonhyeong: r.jeonhyeong || r['전형'] || null,
      });
      added += 1;
    }
    return added;
  });
  return tx(Array.isArray(rows) ? rows : []);
}

module.exports = {
  open, upsertStudent, listStudents, listGroups, getStudent, upsertRecord, replaceBooks, deleteStudent,
  dashboardData, editsFor, areasForGroup,
  getAreasConfig, setAreasConfig, getSpellIgnore, saveSpellIgnore, addSpellIgnore, getCategory, upsertGroup, listGroupsDetailed, limitFor, limitForGroup, setGroupByte, bulkAddStudents,
  deleteGroup, removeMembership, renameGroup,
  CATEGORIES, DEFAULT_AREAS_CONFIG,
};
