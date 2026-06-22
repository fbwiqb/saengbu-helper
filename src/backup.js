const crypto = require('crypto');

const MAGIC = 'SBBAK01';
const TABLES = ['students', 'memberships', 'records', 'legacy', 'books', 'edits_log', 'exemplars_added', 'app_config', 'groups'];

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32);
}

function encrypt(plain, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    magic: MAGIC, kdf: 'scrypt', cipher: 'aes-256-gcm',
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), data: ct.toString('base64'),
  };
}

function decrypt(env, password) {
  if (!env || env.magic !== MAGIC) throw new Error('FORMAT');
  const key = deriveKey(password, Buffer.from(env.salt, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString('utf8');
}

function dump(db) {
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}

function restore(db, data) {
  const tx = db.transaction(() => {
    for (const t of TABLES) {
      const rows = (data.tables && data.tables[t]) || [];
      const cols = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      db.prepare(`DELETE FROM ${t}`).run();
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) continue;
        const sql = `INSERT INTO ${t} (${keys.map((k) => '"' + k + '"').join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
        db.prepare(sql).run(...keys.map((k) => row[k]));
      }
    }
  });
  tx();
}

function exportBackup(db, password) {
  const pw = String(password == null ? '' : password);
  if (pw.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다');
  return encrypt(JSON.stringify(dump(db)), pw);
}

function importBackup(db, password, env) {
  const pw = String(password == null ? '' : password);
  if (!pw) throw new Error('비밀번호를 입력하세요');
  let json;
  try {
    json = decrypt(env, pw);
  } catch (e) {
    if (e.message === 'FORMAT') throw new Error('백업 파일 형식이 아닙니다');
    throw new Error('비밀번호가 틀렸거나 손상된 백업입니다');
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('백업 내용을 해석할 수 없습니다');
  }
  if (!data || !data.tables) throw new Error('백업 구조가 올바르지 않습니다');
  restore(db, data);
  const counts = {};
  for (const t of TABLES) counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  return { ok: true, counts };
}

module.exports = { exportBackup, importBackup, TABLES };
