const express = require('express');
const path = require('path');
const { calcBytes, evaluate, TARGETS } = require('./bytes');
const { loadForbidden, scan } = require('./forbidden');
const { extractBooks } = require('./books');
const db_ = require('./db');

const FORBIDDEN = loadForbidden(path.join(__dirname, '../data/forbidden.json'));

function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '../public')));

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

  app.get('/api/forbidden', (_req, res) => res.json(FORBIDDEN));
  app.get('/api/byte-targets', (_req, res) => res.json(TARGETS));

  app.get('/api/config', (_req, res) => res.json({ categories: db_.CATEGORIES, areas: db_.getAreasConfig(db) }));
  app.put('/api/config', (req, res) => {
    const saved = db_.setAreasConfig(db, (req.body || {}).areas || {});
    res.json({ categories: db_.CATEGORIES, areas: saved });
  });

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
    res.json({ ...e, overLimit: e.status === 'over', forbiddenHits: scan(text, FORBIDDEN) });
  });

  app.get('/api/template', (_req, res) => {
    const csv = '﻿학번,이름,번호,성별,내신,전형\n30401,홍길동,1,남,3.50,농어촌\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-template.csv"');
    res.send(csv);
  });

  app.post('/api/extract-books', (req, res) => res.json(extractBooks((req.body || {}).text || '')));

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
    if (!req.body || !req.body.hakbun) return res.status(400).json({ error: 'hakbun 필요' });
    db_.upsertStudent(db, req.body);
    res.json(db_.getStudent(db, req.body.hakbun));
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
  app.get('/api/overlap', (req, res) => res.json(db_.overlapReport(db, req.query.group)));
  app.get('/api/edits', (req, res) => res.json(db_.recentEdits(db, req.query.group, req.query.limit)));
  app.get('/api/history/:hakbun/:area', (req, res) => res.json(db_.editsFor(db, req.params.hakbun, req.params.area, req.query.subject || '')));
  app.get('/api/quality', (req, res) => res.json(db_.qualityStats(db, req.query.group)));

  app.post('/api/promote/:hakbun/:area', (req, res) => {
    if (!db_.getStudent(db, req.params.hakbun)) return res.status(404).json({ error: 'not found' });
    const subject = req.query.subject || '';
    const ex = db_.promoteExemplar(db, req.params.hakbun, req.params.area, subject);
    if (!ex) return res.status(404).json({ error: 'record not found' });
    res.json(ex);
  });

  app.put('/api/legacy/:hakbun', (req, res) => {
    if (!db_.getStudent(db, req.params.hakbun)) return res.status(404).json({ error: 'not found' });
    db_.saveLegacy(db, { ...req.body, hakbun: req.params.hakbun });
    res.json(db_.getStudent(db, req.params.hakbun));
  });

  return app;
}

module.exports = { createApp };
