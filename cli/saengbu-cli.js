#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { calcBytes } = require('../src/bytes');
const db_ = require('../src/db');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '../saengbu.db');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const cmd = process.argv[2];
  const db = db_.open(DB_FILE);

  if (cmd === 'import-roster') {
    const file = process.argv[3];
    const group = arg('--group');
    if (!file || !group) { console.error('usage: import-roster <file.json> --group <tag>'); process.exit(1); }
    const roster = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const s of roster) db_.upsertStudent(db, { ...s, group_tag: group });
    console.log(`imported ${roster.length} into ${group}`);

  } else if (cmd === 'set') {
    const hakbun = process.argv[3];
    const area = process.argv[4];
    const subject = arg('--subject') || '';
    const file = arg('--file');
    if (!hakbun || !area || !file) { console.error('usage: set <hakbun> <area> [--subject S] --file body.txt'); process.exit(1); }
    const body = fs.readFileSync(file, 'utf8');
    db_.upsertRecord(db, { hakbun, area, subject, body, bytes: calcBytes(body), status: '초안' });
    console.log(`set ${hakbun}/${area}${subject ? '/' + subject : ''} (${calcBytes(body)} bytes)`);

  } else if (cmd === 'legacy') {
    const hakbun = process.argv[3];
    db_.saveLegacy(db, { hakbun, dup_avoid: arg('--dup') || '', growth_link: arg('--growth') || '', gap_fill: arg('--gap') || '' });
    console.log(`legacy saved for ${hakbun}`);

  } else if (cmd === 'get') {
    const hakbun = process.argv[3];
    console.log(JSON.stringify(db_.getStudent(db, hakbun), null, 2));

  } else if (cmd === 'status') {
    const group = arg('--group');
    const groups = group ? [group] : db_.listGroups(db).map((g) => g.group_tag);
    for (const g of groups) {
      const d = db_.dashboardData(db, g);
      console.log(`[${g}] 완료율 ${d.completion}% (완료 ${d.summary['완료']}/${d.totalCells})  미작성 ${d.summary['미작성']} · 초안 ${d.summary['초안']} · 검증 ${d.summary['검증']}`);
    }

  } else if (cmd === 'pending') {
    const group = arg('--group');
    if (!group) { console.error('usage: pending --group <tag>'); process.exit(1); }
    const d = db_.dashboardData(db, group);
    const rows = d.rows.filter((r) => r.cells.some((c) => c.status === '미작성'));
    if (!rows.length) { console.log('미작성 없음'); }
    for (const r of rows) {
      const areas = r.cells.filter((c) => c.status === '미작성').map((c) => c.area).join(',');
      console.log(`${r.hakbun} ${r.name}  (${areas})`);
    }

  } else if (cmd === 'feedback') {
    const group = arg('--group');
    const limit = Number(arg('--limit')) || 20;
    const edits = db_.recentEdits(db, group, limit);
    if (!edits.length) { console.log('수정 이력 없음'); }
    for (const e of edits) {
      console.log(`[${e.created_at}] ${e.hakbun} ${e.area}${e.subject ? '/' + e.subject : ''}${e.reason ? ' · ' + e.reason : ''}`);
      console.log(`  - before: ${e.before}`);
      console.log(`  + after : ${e.after}`);
    }

  } else if (cmd === 'promote') {
    const hakbun = process.argv[3];
    const area = process.argv[4];
    const subject = arg('--subject') || '';
    if (!hakbun || !area) { console.error('usage: promote <hakbun> <area> [--subject S]'); process.exit(1); }
    const ex = db_.promoteExemplar(db, hakbun, area, subject);
    if (!ex) { console.error('record not found'); process.exit(1); }
    console.log(`promoted ${hakbun}/${area}${subject ? '/' + subject : ''} (${ex.text.length} chars)`);

  } else {
    console.error('commands: import-roster | set | legacy | get | status | pending | feedback | promote');
    process.exit(1);
  }
}

main();
