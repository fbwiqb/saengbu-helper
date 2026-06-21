const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { group: null, hakbun: null, area: null, subject: '', targets: {}, forbidden: [], student: null };

async function j(url, opt) { const r = await fetch(url, opt); return r.json(); }

async function boot() {
  state.targets = await j('/api/byte-targets');
  state.forbidden = await j('/api/forbidden');
  const all = await j('/api/students');
  const groups = [...new Set(all.map((s) => s.group_tag))];
  $('#groupSel').innerHTML = groups.map((g) => `<option>${esc(g)}</option>`).join('');
  state.group = groups[0] || null;
  $('#groupSel').onchange = (e) => { state.group = e.target.value; loadList(); refreshView(); };
  $('#addBtn').onclick = addStudent;
  $('#body').addEventListener('input', renderGauge);
  $('#saveBtn').onclick = saveRecord;
  $('#copyBtn').onclick = () => navigator.clipboard.writeText($('#revised').value || $('#body').value);
  $('#lgSave').onclick = saveLegacy;
  $('#promoteBtn').onclick = promote;
  $('#vStudent').onclick = () => setView('student');
  $('#vDash').onclick = () => setView('dash');
  $('#vOverlap').onclick = () => setView('overlap');
  $('#dashFilter').onchange = renderDash;
  state.view = 'student';
  loadList();
}

function setView(v) {
  state.view = v;
  $('#vStudent').classList.toggle('sel', v === 'student');
  $('#vDash').classList.toggle('sel', v === 'dash');
  $('#vOverlap').classList.toggle('sel', v === 'overlap');
  $('#dashView').hidden = v !== 'dash';
  $('#overlapView').hidden = v !== 'overlap';
  $('#head').hidden = v !== 'student';
  $('#tabs').hidden = v !== 'student';
  $('#editor').hidden = v !== 'student' || !state.hakbun;
  refreshView();
}

function refreshView() {
  if (state.view === 'dash') renderDash();
  else if (state.view === 'overlap') renderOverlap();
}

async function loadList() {
  const list = await j('/api/students?group=' + encodeURIComponent(state.group || ''));
  $('#studentList').innerHTML = list.map((s) =>
    `<li data-h="${esc(s.hakbun)}" class="${s.hakbun === state.hakbun ? 'sel' : ''}">${esc(s.hakbun)} ${esc(s.name)}
     <span class="badge ${esc(s.status)}">${esc(s.status || '')}</span></li>`).join('');
  $('#studentList').querySelectorAll('li').forEach((li) => { li.onclick = () => openStudent(li.dataset.h); });
}

async function addStudent() {
  const hakbun = prompt('학번?'); if (!hakbun) return;
  const name = prompt('이름?') || '';
  await j('/api/students', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hakbun, name, group_tag: state.group }) });
  loadList();
}

async function openStudent(hakbun) {
  if (state.view !== 'student') setView('student');
  state.hakbun = hakbun;
  state.student = await j('/api/students/' + hakbun);
  const g = state.group || '';
  $('#headInfo').textContent = `${state.student.hakbun} ${state.student.name} · 내신 ${state.student.naesin ?? '-'} · ${state.student.jeonhyeong || ''} · [${g}] · 소속:${(state.student.groups || []).join(',')}`;
  const isHomeroom = g.includes('담임');
  const isClub = g.includes('동아리');
  const areas = isHomeroom ? ['자율', '진로', '행특'] : isClub ? ['동아리'] : ['세특'];
  $('#tabs').innerHTML = areas.map((a) => `<button data-a="${esc(a)}">${esc(a)}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => selectArea(b.dataset.a); });
  $('#legacyBox').hidden = !isHomeroom;
  if (isHomeroom) {
    $('#lgDup').value = state.student.legacy.dup_avoid || '';
    $('#lgGrowth').value = state.student.legacy.growth_link || '';
    $('#lgGap').value = state.student.legacy.gap_fill || '';
  }
  loadList();
  selectArea(areas[0]);
}

function selectArea(area) {
  state.area = area;
  state.subject = (area === '세특' || area === '동아리') ? (state.group || '') : '';
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.a === area));
  const rec = (state.student.records || []).find((r) => r.area === area && r.subject === state.subject) || {};
  $('#body').value = rec.body || '';
  $('#revised').value = rec.revised || '';
  $('#reason').value = rec.reason || '';
  $('#status').value = rec.status || '미작성';
  $('#qExp').value = rec.q_exp ?? '';
  $('#qThink').value = rec.q_think ?? '';
  $('#qGrowth').value = rec.q_growth ?? '';
  $('#qAuthentic').value = rec.q_authentic ?? '';
  $('#accepted').checked = !!rec.accepted;
  $('#editor').hidden = false;
  renderGauge();
  renderBooks();
  renderEdits();
}

async function renderEdits() {
  const edits = await j('/api/edits?group=' + encodeURIComponent(state.group || '') + '&limit=50');
  const mine = edits.filter((e) => e.hakbun === state.hakbun && e.area === state.area);
  $('#editsPanel').innerHTML = mine.length
    ? '<strong>수정이력</strong>' + mine.map((e) =>
        `<div class="edit"><span class="t">${esc(e.created_at)}</span>${e.reason ? ' · ' + esc(e.reason) : ''}
         <div class="b">전: ${esc(e.before)}</div><div class="a">후: ${esc(e.after)}</div></div>`).join('')
    : '';
}

function renderGauge() {
  const text = $('#body').value;
  const limit = state.targets[state.area] || 0;
  let bytes = 0;
  for (const ch of text) bytes += ch === '\n' ? 2 : ch.charCodeAt(0) > 127 ? 3 : 1;
  const pct = limit ? (bytes / limit) * 100 : 0;
  const g = $('.gauge');
  g.className = 'gauge ' + (bytes > limit ? 'over' : pct >= 95 ? 'full' : pct < 70 ? 'low' : 'ok');
  $('#gaugeFill').style.width = Math.min(100, pct) + '%';
  $('#gaugeText').textContent = `${state.area}${state.subject ? '·' + state.subject : ''}  ${bytes}/${limit} (${pct.toFixed(0)}%)`;
  const hits = [];
  for (const t of state.forbidden) if (text.includes(t)) hits.push(t);
  $('#forbidden').innerHTML = hits.length ? '⚠ 금지어: ' + hits.map((h) => `<span>${esc(h)}</span>`).join(', ') : '';
}

async function renderBooks() {
  const books = await j('/api/extract-books', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: $('#body').value }) });
  $('#books').innerHTML = books.length ? '📖 ' + books.map((b) => `${esc(b.title)}(${esc(b.author)})`).join(', ') : '';
}

async function saveRecord() {
  const url = `/api/records/${state.hakbun}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`;
  state.student = await j(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      body: $('#body').value, revised: $('#revised').value, reason: $('#reason').value, status: $('#status').value,
      q_exp: $('#qExp').value, q_think: $('#qThink').value, q_growth: $('#qGrowth').value, q_authentic: $('#qAuthentic').value,
      accepted: $('#accepted').checked,
    }) });
  renderBooks();
  renderEdits();
  loadList();
}

async function promote() {
  if (!state.hakbun || !state.area) return;
  const url = `/api/promote/${state.hakbun}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`;
  const r = await j(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  alert(r.error ? '승격 실패: ' + r.error : '우수예시로 승격되었습니다.');
}

async function renderDash() {
  const d = await j('/api/dashboard?group=' + encodeURIComponent(state.group || ''));
  $('#dashProg').innerHTML =
    `<div class="progbar"><div class="fill" style="width:${d.completion}%"></div></div>
     <div class="summary">완료율 ${d.completion}% · 완료 ${d.summary['완료']} · 검증 ${d.summary['검증']} · 초안 ${d.summary['초안']} · 미작성 ${d.summary['미작성']}</div>`;
  const filter = $('#dashFilter').value;
  const head = '<tr><th>학번</th><th>이름</th>' + d.areas.map((a) => `<th>${esc(a)}</th>`).join('') + '</tr>';
  const rows = d.rows.map((r) => {
    const cells = r.cells.map((c) => {
      const dim = filter && c.status !== filter ? ' dim' : '';
      return `<td class="cell st-${esc(c.status)}${dim}">${esc(c.status)}<br><small>${c.bytes}B ${c.pct}%</small></td>`;
    }).join('');
    return `<tr><td>${esc(r.hakbun)}</td><td>${esc(r.name)}</td>${cells}</tr>`;
  }).join('');
  $('#dashTable').innerHTML = `<table class="dash">${head}${rows}</table>`;
}

async function renderOverlap() {
  const o = await j('/api/overlap?group=' + encodeURIComponent(state.group || ''));
  $('#overlapEvents').innerHTML = o.events.length
    ? '<table class="dash"><tr><th>표현</th><th>영역</th><th>사용 학생</th></tr>' +
      o.events.map((e) =>
        `<tr><td>${esc(e.term)}</td><td>${esc(e.area)}</td><td>${e.students.map((s) => esc(s.hakbun + ' ' + s.name)).join(', ')}</td></tr>`).join('') +
      '</table>'
    : '<p class="muted">2명 이상 공유 표현 없음</p>';
  $('#overlapPairs').innerHTML = o.similarPairs.length
    ? o.similarPairs.map((p) =>
        `<div class="warn">⚠ ${esc(p.area)} · ${esc(p.a.hakbun + ' ' + p.a.name)} ↔ ${esc(p.b.hakbun + ' ' + p.b.name)} · 유사도 ${p.score}</div>`).join('')
    : '<p class="muted">유사도 0.3 이상 쌍 없음</p>';
}

async function saveLegacy() {
  await j('/api/legacy/' + state.hakbun, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dup_avoid: $('#lgDup').value, growth_link: $('#lgGrowth').value, gap_fill: $('#lgGap').value }) });
}

boot();
