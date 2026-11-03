const test = require('node:test');
const assert = require('node:assert/strict');
const db_ = require('../src/db');

test('chosen group prefix preserves spaces, inherits to new students, and validates atomically', () => {
  const db = db_.open(':memory:');
  try {
    db_.bulkAddStudents(db, '과학', '세특', [{ hakbun: '1', name: '학생', byte_limit: 10 }]);
    const key = db_.studentKey('과학', '1');
    db_.upsertRecord(db, { hakbun: key, area: '세특', subject: '과학', body: '기존 기록', bytes: 13 });
    const records = db.prepare('SELECT * FROM records').all();
    db_.setGroupPrefix(db, '과학', true, '탐구: ');
    assert.equal(db_.getStudent(db, key).required_prefix, '탐구: ');
    db_.bulkAddStudents(db, '과학', '세특', [{ hakbun: '2', name: '추가' }]);
    assert.equal(db_.getStudent(db, db_.studentKey('과학', '2')).required_prefix, '탐구: ');
    for (const invalid of ['', '  ', 123, '가'.repeat(101), '너무 긴 머리말 ']) {
      assert.throws(() => db_.setGroupPrefix(db, '과학', true, invalid));
      assert.equal(db_.getStudent(db, key).required_prefix, '탐구: ');
      assert.equal(db_.listGroupsDetailed(db)[0].required_prefix, '탐구: ');
    }
    db_.upsertStudent(db, { hakbun: key, required_prefix: '(개별) ' });
    assert.equal(db_.getStudent(db, key).required_prefix, '(개별) ');
    db_.setGroupPrefix(db, '과학', false);
    assert.equal(db_.getStudent(db, key).required_prefix, null);
    assert.deepEqual(db.prepare('SELECT * FROM records').all(), records);
  } finally { db.close(); }
});
