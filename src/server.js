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

  app.get('/api/forbidden', (_req, res) => res.json(FORBIDDEN));
  app.get('/api/byte-targets', (_req, res) => res.json(TARGETS));

  app.post('/api/verify', (req, res) => {
    const { text = '', area = '' } = req.body || {};
    const e = evaluate(text, area);
    res.json({ ...e, overLimit: e.status === 'over', forbiddenHits: scan(text, FORBIDDEN) });
  });

  app.post('/api/extract-books', (req, res) => res.json(extractBooks((req.body || {}).text || '')));

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
