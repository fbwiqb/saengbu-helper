const express = require('express');
const path = require('path');
const https = require('https');
const { calcBytes, evaluate } = require('./bytes');
const { loadRules, scan } = require('./forbidden');
const { extractBooks } = require('./books');
const backup = require('./backup');
const db_ = require('./db');

const RULES = loadRules(path.join(__dirname, '../data/forbidden.json'));

function createApp(db) {
  const app = express();
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: '다른 출처에서의 요청은 허용되지 않습니다' });
    }
    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, '../public')));

  app.post('/api/backup/export', (req, res) => {
    try { res.json(backup.exportBackup(db, (req.body || {}).password)); }
    catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });
  app.post('/api/backup/import', (req, res) => {
    try { res.json(backup.importBackup(db, (req.body || {}).password, (req.body || {}).envelope)); }
    catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  app.post('/api/open-folder', (_req, res) => {
    try {
      const { shell } = require('electron');
      const dir = path.resolve(path.dirname(process.env.DB_FILE || 'saengbu.db'));
      shell.openPath(dir);
      res.json({ ok: true, dir });
    } catch (e) {
      res.status(400).json({ error: '데스크톱 앱에서만 폴더를 열 수 있습니다', detail: String(e.message || e) });
    }
  });

  app.post('/api/open-external', (req, res) => {
    try {
      const url = String((req.body || {}).url || '');
      if (!/^https:\/\/github\.com\/fbwiqb\/saengbu-helper(\/|$)/.test(url)) return res.status(400).json({ error: '허용되지 않은 주소' });
      const { shell } = require('electron');
      shell.openExternal(url);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: '데스크톱 앱에서만 열 수 있습니다', detail: String(e.message || e) });
    }
  });

  app.get('/api/release-notes', (_req, res) => {
    const opts = { hostname: 'api.github.com', path: '/repos/fbwiqb/saengbu-helper/releases?per_page=15', headers: { 'User-Agent': 'saengbu-helper', Accept: 'application/vnd.github+json' } };
    const r = https.get(opts, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        if (resp.statusCode >= 400) { res.status(502).json({ error: 'GitHub 응답 오류 ' + resp.statusCode }); return; }
        try {
          const arr = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const clean = (s) => String(s || '').replace(new RegExp(String.fromCharCode(0xFEFF), 'g'), '').replace(/﻿/g, '').replace(/﻿/g, '').replace(/﻿/g, '').replace(/^[ \t]*Co-Authored-By:.*$/gim, '').replace(/\s+$/, '');
          res.json((Array.isArray(arr) ? arr : []).filter((x) => !x.draft).map((x) => ({ version: x.tag_name || '', name: x.name || '', date: x.published_at || '', body: clean(x.body) })));
        } catch (e) { res.status(502).json({ error: '응답 해석 실패' }); }
      });
    });
    r.on('error', (e) => res.status(502).json({ error: '연결 실패', detail: String(e.message || e) }));
    r.setTimeout(15000, () => r.destroy(new Error('timeout')));
  });

  app.post('/api/reset', (req, res) => {
    try {
      if ((req.body || {}).confirm !== '삭제') return res.status(400).json({ error: "확인 문구('삭제')가 일치하지 않습니다" });
      db.exec('DELETE FROM records; DELETE FROM students; DELETE FROM memberships; DELETE FROM groups; DELETE FROM legacy; DELETE FROM books; DELETE FROM edits_log; DELETE FROM exemplars_added;');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  app.get('/api/forbidden', (_req, res) => res.json(RULES));

  const getFbdIgnore = () => {
    const row = db.prepare('SELECT value FROM app_config WHERE key=?').get('forbidden_ignore');
    if (!row) return [];
    try { const a = JSON.parse(row.value); return Array.isArray(a) ? a : []; } catch { return []; }
  };
  const saveFbdIgnore = (arr) => {
    const clean = [...new Set((Array.isArray(arr) ? arr : []).map((w) => String(w || '').trim()).filter(Boolean))];
    db.prepare(`INSERT INTO app_config (key, value) VALUES ('forbidden_ignore', @v)
      ON CONFLICT(key) DO UPDATE SET value=@v`).run({ v: JSON.stringify(clean) });
    return clean;
  };
  app.get('/api/forbidden-ignore', (_req, res) => res.json(getFbdIgnore()));
  app.post('/api/forbidden-ignore', (req, res) => res.json(saveFbdIgnore([...getFbdIgnore(), (req.body || {}).word])));
  app.post('/api/forbidden-scan', (req, res) => {
    const ign = new Set(getFbdIgnore());
    res.json(scan((req.body || {}).text || '', RULES).filter((h) => !ign.has(h.term)));
  });

  app.get('/api/common-phrases', (_req, res) => {
    try {
      const row = db.prepare("SELECT value FROM app_config WHERE key = 'common_phrases'").get();
      res.json(row && row.value ? JSON.parse(row.value) : []);
    } catch (e) { res.json([]); }
  });
  app.put('/api/common-phrases', (req, res) => {
    try {
      const arr = Array.isArray((req.body || {}).phrases) ? req.body.phrases : [];
      const clean = arr
        .filter((p) => p && String(p.text || '').trim())
        .map((p) => ({ id: String(p.id || ''), group_tag: String(p.group_tag || ''), title: String(p.title || '').slice(0, 60), text: String(p.text || '') }));
      db.prepare("INSERT INTO app_config(key,value) VALUES('common_phrases',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(clean));
      res.json(clean);
    } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  });

  app.get('/api/config', (_req, res) => res.json({ categories: db_.CATEGORIES, areas: db_.getAreasConfig(db) }));
  app.put('/api/config', (req, res) => {
    const saved = db_.setAreasConfig(db, (req.body || {}).areas || {});
    res.json({ categories: db_.CATEGORIES, areas: saved });
  });

  app.get('/api/spell-ignore', (_req, res) => res.json(db_.getSpellIgnore(db)));
  app.post('/api/spell-ignore', (req, res) => res.json(db_.addSpellIgnore(db, (req.body || {}).word)));
  app.put('/api/spell-ignore', (req, res) => res.json(db_.saveSpellIgnore(db, (req.body || {}).words || [])));

  app.get('/api/groups', (_req, res) => res.json(db_.listGroupsDetailed(db)));
  app.post('/api/groups', (req, res) => {
    const { group_tag, category } = req.body || {};
    if (!group_tag) return res.status(400).json({ error: 'group_tag 필요' });
    const cat = db_.upsertGroup(db, group_tag, category);
    res.json({ group_tag, category: cat });
  });

  app.delete('/api/groups/:tag', (req, res) => {
    res.json(db_.deleteGroup(db, req.params.tag));
  });
  app.put('/api/groups/:tag/rename', (req, res) => {
    try {
      const cat = db_.renameGroup(db, req.params.tag, (req.body || {}).newTag);
      res.json({ ok: true, category: cat });
    } catch (e) {
      res.status(400).json({ error: String(e.message || e) });
    }
  });
  app.put('/api/groups/:tag/byte', (req, res) => {
    const v = db_.setGroupByte(db, req.params.tag, (req.body || {}).byte_limit);
    res.json({ ok: true, byte_limit: v });
  });
  app.delete('/api/students/:hakbun/membership/:tag', (req, res) => {
    db_.removeMembership(db, req.params.hakbun, req.params.tag);
    res.json({ ok: true });
  });

  app.post('/api/students/bulk', (req, res) => {
    const { group_tag, category, students } = req.body || {};
    if (!group_tag) return res.status(400).json({ error: 'group_tag 필요' });
    if (!Array.isArray(students) || !students.length) return res.status(400).json({ error: '학생 목록 필요' });
    const added = db_.bulkAddStudents(db, group_tag, category, students);
    res.json({ ok: true, added, group_tag });
  });

  app.post('/api/verify', (req, res) => {
    const { text = '', area = '', limit } = req.body || {};
    const e = evaluate(text, area, Number(limit) || (area ? db_.limitFor(db, area) : 0));
    res.json({ ...e, overLimit: e.status === 'over', forbiddenHits: scan(text, RULES) });
  });

  app.get('/api/template', (_req, res) => {
    const csv = '﻿학번,이름,번호,성별,내신,전형\n30401,홍길동,1,남,3.50,농어촌\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-template.csv"');
    res.send(csv);
  });

  app.post('/api/spellcheck', async (req, res) => {
    const text = (req.body || {}).text || '';
    if (!text.trim()) return res.json({ errors: [] });
    try {
      const errors = await require('./spell').check(text);
      res.json({ errors });
    } catch (e) {
      res.status(502).json({ error: '부산대 검사기 연결/해석 실패', detail: String(e.message || e) });
    }
  });

  app.get('/api/students', (req, res) => res.json(db_.listStudents(db, req.query.group)));

  app.post('/api/students', (req, res) => {
    const b = req.body || {};
    if (!b.hakbun) return res.status(400).json({ error: 'hakbun 필요' });
    const key = b.group_tag ? db_.studentKey(b.group_tag, b.hakbun) : String(b.hakbun);
    db_.upsertStudent(db, { ...b, hakbun: key });
    res.json(db_.getStudent(db, key));
  });

  app.get('/api/students/:hakbun', (req, res) => {
    const s = db_.getStudent(db, req.params.hakbun);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json(s);
  });

  app.put('/api/students/:hakbun', (req, res) => {
    db_.upsertStudent(db, { ...req.body, hakbun: req.params.hakbun });
    res.json(db_.getStudent(db, req.params.hakbun));
  });

  app.delete('/api/students/:hakbun', (req, res) => {
    db_.deleteStudent(db, req.params.hakbun);
    res.json({ ok: true });
  });

  app.put('/api/records/:hakbun/:area', (req, res) => {
    const { hakbun, area } = req.params;
    if (!db_.getStudent(db, hakbun)) return res.status(404).json({ error: 'not found' });
    const subject = req.query.subject || '';
    const b = req.body || {};
    const body = b.body || '';
    const q = (v) => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error('점수는 숫자여야 합니다');
      return n;
    };
    let scores;
    try {
      scores = { q_exp: q(b.q_exp), q_think: q(b.q_think), q_growth: q(b.q_growth), q_authentic: q(b.q_authentic) };
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    db_.upsertRecord(db, {
      hakbun, area, subject,
      body,
      revised: b.revised || '',
      reason: b.reason || '',
      bytes: calcBytes(body),
      status: b.status || '초안',
      q_exp: scores.q_exp, q_think: scores.q_think, q_growth: scores.q_growth, q_authentic: scores.q_authentic,
      accepted: b.accepted ? 1 : 0,
    });
    db_.replaceBooks(db, hakbun, area, subject, extractBooks(body));
    res.json(db_.getStudent(db, hakbun));
  });

  app.get('/api/dashboard', (req, res) => res.json(db_.dashboardData(db, req.query.group)));
  app.get('/api/history/:hakbun/:area', (req, res) => res.json(db_.editsFor(db, req.params.hakbun, req.params.area, req.query.subject || '')));

  return app;
}

module.exports = { createApp };
