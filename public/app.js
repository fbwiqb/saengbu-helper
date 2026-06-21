const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { group: null, hakbun: null, area: null, subject: '', targets: {}, forbidden: [], student: null, view: 'student', listCache: [] };

async function j(url, opt) { const r = await fetch(url, opt); return r.json(); }

function calcBytes(text) {
  let b = 0;
  for (const ch of String(text || '')) {
    if (ch === '\n') { b += 2; continue; }
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f) b += 1; else if (cp <= 0x7ff) b += 2; else if (cp <= 0xffff) b += 3; else b += 4;
  }
  return b;
}

async function boot() {
  state.targets = await j('/api/byte-targets');
  state.forbidden = await j('/api/forbidden');
  const all = await j('/api/students');
  const groups = [...new Set(all.map((s) => s.group_tag).filter(Boolean))];
  $('#groupSel').innerHTML = groups.map((g) => `<option>${esc(g)}</option>`).join('');
  state.group = groups[0] || null;
  $('#groupSel').onchange = (e) => { state.group = e.target.value; state.hakbun = null; loadList(); refreshView(); };
  $('#addBtn').onclick = addStudent;
  $('#body').addEventListener('input', renderAssist);
  $('#saveBtn').onclick = saveRecord;
  $('#copyBtn').onclick = () => navigator.clipboard.writeText($('#revised').value || $('#body').value);
  $('#lgSave').onclick = saveLegacy;
  $('#promoteBtn').onclick = promote;
  $('#nextBtn').onclick = gotoNextUnwritten;
  $('#vStudent').onclick = () => setView('student');
  $('#vDash').onclick = () => setView('dash');
  $('#vOverlap').onclick = () => setView('overlap');
  $('#dashFilter').onchange = renderDash;
  loadList();
}

function setView(v) {
  state.view = v;
  $('#vStudent').classList.toggle('sel', v === 'student');
  $('#vDash').classList.toggle('sel', v === 'dash');
  $('#vOverlap').classList.toggle('sel', v === 'overlap');
  $('#dashView').hidden = v !== 'dash';
  $('#overlapView').hidden = v !== 'overlap';
  $('#head').hidden = v !== 'student' || !state.hakbun;
  $('#tabs').hidden = v !== 'student' || !state.hakbun;
  $('#editor').hidden = v !== 'student' || !state.hakbun;
  refreshView();
}

function refreshView() {
  if (state.view === 'dash') renderDash();
  else if (state.view === 'overlap') renderOverlap();
}

async function loadList() {
  const list = await j('/api/students?group=' + encodeURIComponent(state.group || ''));
  state.listCache = list;
  $('#studentList').innerHTML = list.map((s) =>
    `<li data-h="${esc(s.hakbun)}" class="${s.hakbun === state.hakbun ? 'sel' : ''}">
       <span class="nm">${esc(s.hakbun)} ${esc(s.name)}</span>
       <span class="badge ${esc(s.status)}">${esc(s.status || '미작성')}</span></li>`).join('');
  $('#studentList').querySelectorAll('li').forEach((li) => { li.onclick = () => openStudent(li.dataset.h); });
}

async function addStudent() {
  const hakbun = prompt('학번?'); if (!hakbun) return;
  const name = prompt('이름?') || '';
  await j('/api/students', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hakbun, name, group_tag: state.group }) });
  loadList();
}

function areasFor(g) {
  g = g || '';
  if (g.includes('담임')) return ['자율', '진로', '행특'];
  if (g.includes('동아리')) return ['동아리'];
  return ['세특'];
}

async function openStudent(hakbun) {
  state.hakbun = hakbun;
  state.student = await j('/api/students/' + hakbun);
  if (state.view !== 'student') { setView('student'); } else { setView('student'); }
  const g = state.group || '';
  const s = state.student;
  $('#headInfo').innerHTML = `${esc(s.hakbun)} ${esc(s.name)}<span class="sub">내신 ${esc(s.naesin ?? '-')} · ${esc(s.jeonhyeong || '-')} · [${esc(g)}]${(s.groups || []).length > 1 ? ' · 소속 ' + esc((s.groups || []).join(',')) : ''}</span>`;
  const isHomeroom = g.includes('담임');
  const areas = areasFor(g);
  $('#tabs').innerHTML = areas.map((a) => `<button data-a="${esc(a)}">${esc(a)}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => { b.onclick = () => selectArea(b.dataset.a); });
  $('#legacyBox').hidden = !isHomeroom;
  if (isHomeroom) {
    $('#lgDup').value = s.legacy.dup_avoid || '';
    $('#lgGrowth').value = s.legacy.growth_link || '';
    $('#lgGap').value = s.legacy.gap_fill || '';
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
  renderAssist();
  renderBooks();
  renderEdits();
}

async function gotoNextUnwritten() {
  const list = state.listCache.length ? state.listCache : await j('/api/students?group=' + encodeURIComponent(state.group || ''));
  const idx = list.findIndex((s) => s.hakbun === state.hakbun);
  const order = list.slice(idx + 1).concat(list.slice(0, idx + 1));
  const next = order.find((s) => (s.status || '미작성') === '미작성') || order.find((s) => s.hakbun !== state.hakbun);
  if (next) openStudent(next.hakbun);
}

function renderGauge() {
  const text = $('#body').value;
  const limit = state.targets[state.area] || 0;
  const bytes = calcBytes(text);
  const pct = limit ? (bytes / limit) * 100 : 0;
  const cls = bytes > limit ? 'over' : pct >= 95 ? 'full' : pct < 70 ? 'low' : 'ok';
  $('.gauge').className = 'gauge ' + cls;
  $('#gaugeFill').style.width = Math.min(100, pct) + '%';
  $('#gaugeArea').textContent = `${state.area}${state.subject ? ' · ' + state.subject : ''}`;
  $('#gaugeText').textContent = `${bytes} / ${limit} B (${pct.toFixed(0)}%)`;
  return { bytes, limit, pct, cls };
}

function renderAssist() {
  const text = $('#body').value;
  const { bytes, limit, pct, cls } = renderGauge();
  const items = [];

  if (limit) {
    if (cls === 'over') items.push({ k: 'err', ico: '⚠', html: `한도 초과 — ${bytes - limit}B 줄이세요` });
    else if (cls === 'full') items.push({ k: 'ok', ico: '●', html: `한도 근접 (${pct.toFixed(0)}%)` });
    else if (cls === 'low') items.push({ k: 'warn', ico: '○', html: `분량 부족 (${pct.toFixed(0)}%)` });
    else items.push({ k: 'ok', ico: '●', html: `적정 분량 (${pct.toFixed(0)}%)` });
  }

  const hits = state.forbidden.filter((t) => t && text.includes(t));
  if (hits.length) {
    items.push({ k: 'err', ico: '⚠', html: '금지어 ' + hits.map((h) => `<span class="chip">${esc(h)}</span>`).join('') });
  }

  const trimmed = text.trim();
  if (trimmed) {
    const endOk = /(?:음|함|됨|임)\.?$/.test(trimmed) || /(?:다)\.?$/.test(trimmed);
    if (!endOk) items.push({ k: 'warn', ico: '○', html: '종결어미 확인 — 명사형(~함/~음) 권장' });
    if (/[!?]/.test(text)) items.push({ k: 'warn', ico: '○', html: '느낌표/물음표는 생기부에 부적절' });
    if (/(저는|제가|나는|내가)/.test(text)) items.push({ k: 'warn', ico: '○', html: '1인칭 표현 발견 — 관찰자 시점 권장' });
  } else {
    items.push({ k: 'warn', ico: '○', html: '본문이 비어 있음' });
  }

  $('#warnings').innerHTML = items.map((i) =>
    `<div class="warn-item ${i.k}"><span class="ico">${i.ico}</span><span>${i.html}</span></div>`).join('');
}

async function renderBooks() {
  const books = await j('/api/extract-books', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: $('#body').value }) });
  $('#books').innerHTML = books.length
    ? books.map((b) => `<div class="bk"><span class="ti">${esc(b.title)}</span><span class="au">· ${esc(b.author)}</span></div>`).join('')
    : '<div class="empty">추출된 독서 없음</div>';
}

async function renderEdits() {
  const edits = await j('/api/edits?group=' + encodeURIComponent(state.group || '') + '&limit=50');
  const mine = edits.filter((e) => e.hakbun === state.hakbun && e.area === state.area);
  $('#editsPanel').innerHTML = mine.length
    ? mine.map((e) =>
        `<div class="edit"><span class="t">${esc(e.created_at)}</span>${e.reason ? ' · ' + esc(e.reason) : ''}
         <div class="b">전: ${esc(e.before)}</div><div class="a">후: ${esc(e.after)}</div></div>`).join('')
    : '<div class="empty">수정 이력 없음</div>';
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
     <div class="summary">완료율 <b>${d.completion}%</b> · 완료 <b>${d.summary['완료']}</b> · 검증 <b>${d.summary['검증']}</b> · 초안 <b>${d.summary['초안']}</b> · 미작성 <b>${d.summary['미작성']}</b></div>`;
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
