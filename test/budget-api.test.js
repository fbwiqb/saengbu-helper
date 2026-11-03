const test = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessage, ServerResponse } = require('node:http');
const { PassThrough } = require('node:stream');
const db_ = require('../src/db');
const { createApp } = require('../src/server');

function request(app, method, url, body) {
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new PassThrough());
    req.method = method; req.url = url; req.headers = {};
    const text = body === undefined ? '' : JSON.stringify(body);
    if (text) req.headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) };
    const res = new ServerResponse(req);
    res.end = chunk => {
      try { resolve({ status: res.statusCode, data: JSON.parse(String(chunk || 'null')) }); }
      catch (error) { reject(error); }
    };
    app.handle(req, res, reject);
    if (text) req.push(Buffer.from(text));
    req.push(null);
  });
}

test('budget API validates input and preserves body/status; prefix route touches metadata only', async () => {
  const db = db_.open(':memory:');
  const app = createApp(db);
  let res = await request(app, 'POST', '/api/students/bulk', { group_tag: '과학13', category: '세특', students: [{ hakbun: '10101', name: '예시', byte_limit: 880, required_prefix: '(2학기) ' }] });
  assert.equal(res.status, 200);
  const hakbun = db_.studentKey('과학13', '10101');
  const key = encodeURIComponent(hakbun);
  res = await request(app, 'PUT', `/api/records/${key}/세특?subject=${encodeURIComponent('과학13')}`, { body: '본문', status: '완료' });
  assert.equal(res.status, 200);
  const before = db.prepare('SELECT * FROM records').all();
  res = await request(app, 'PUT', `/api/students/${key}/budget`, { byte_limit: 689 });
  assert.equal(res.status, 200);
  assert.equal(res.data.byte_limit, 689);
  assert.equal(res.data.required_prefix, '(2학기) ');
  res = await request(app, 'PUT', `/api/students/${key}/budget`, { byte_limit: 0 });
  assert.equal(res.status, 400);
  assert.equal(db_.getStudent(db, hakbun).byte_limit, 689);
  res = await request(app, 'PUT', `/api/groups/${encodeURIComponent('과학13')}/prefix`, { enabled: true, required_prefix: '(탐구) ' });
  assert.equal(res.status, 200);
  assert.equal(db_.getStudent(db, hakbun).required_prefix, '(탐구) ');
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before);
  res = await request(app, 'PUT', `/api/groups/${encodeURIComponent('과학13')}/prefix`, { enabled: true, required_prefix: '   ' });
  assert.equal(res.status, 400);
  assert.equal(db_.getStudent(db, hakbun).required_prefix, '(탐구) ');
  res = await request(app, 'PUT', `/api/groups/${encodeURIComponent('과학13')}/prefix`, { enabled: false });
  assert.equal(res.status, 200);
  assert.equal(db_.getStudent(db, hakbun).required_prefix, null);
  assert.deepEqual(db.prepare('SELECT * FROM records').all(), before);
  const dash = await request(app, 'GET', '/api/dashboard?group=' + encodeURIComponent('과학13'));
  assert.equal(dash.data.rows[0].cells[0].limit, 689);
  res = await request(app, 'PUT', `/api/students/${key}/budget`, { byte_limit: null });
  assert.equal(res.status, 200);
  assert.equal(res.data.byte_limit, null);
  assert.equal((await request(app, 'PUT', '/api/students/missing/budget', { byte_limit: 700 })).status, 404);
  db.close();
});

test('totals and scope APIs stay consistent after a hide toggle', async () => {
  const db = db_.open(':memory:');
  const app = createApp(db);
  db_.upsertGroup(db, '과학', '세특');
  db_.upsertStudent(db, { hakbun: '1', name: '예시', group_tag: '과학' });
  db_.upsertRecord(db, { hakbun: '1', area: '세특', subject: '과학', body: '가나다', bytes: 9 });
  let res = await request(app, 'GET', '/api/dashboard-totals');
  assert.equal(res.data.active.bytes, 9);
  await request(app, 'PUT', '/api/groups/' + encodeURIComponent('과학') + '/hidden', { hidden: true });
  res = await request(app, 'GET', '/api/dashboard-totals');
  assert.equal(res.data.total.bytes, 9);
  assert.equal(res.data.active.bytes, 0);
  assert.equal(res.data.hidden.bytes, 9);
  assert.equal((await request(app, 'GET', '/api/dashboard-all?scope=active')).data.rows.length, 0);
  assert.equal((await request(app, 'GET', '/api/dashboard-all?scope=hidden')).data.rows.length, 1);
  assert.equal((await request(app, 'GET', '/api/dashboard-all?scope=wrong')).status, 400);
  db.close();
});
