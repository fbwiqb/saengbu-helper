const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { group: null, hakbun: null, area: null, subject: '', targets: {}, forbidden: [], student: null, view: 'student', listCache: [], config: { categories: [], areas: {} }, groupCat: {}, sentMode: false, dirty: false, groupsList: [], expanded: new Set(), studsByGroup: {}, sortUnwritten: false, hlMode: false, spellErrors: [], spellBaseText: '', spellIgnore: new Set(), spellHlIdx: null, spellUndo: null };
let dashBodies = {};

const AREA_LABEL = {
  자율: '자율·자치활동', 진로: '진로활동', 동아리: '동아리활동',
  행특: '행동특성및종합의견', 세특: '세부능력및특기사항',
};
const CAT_LABEL = { 담임: '담임교사', 세특: '교과 담당교사', 동아리: '동아리 담당교사', 기타: '기타' };
const CATEGORY_AREAS = {
  담임: ['자율', '진로', '행특'],
  세특: ['세특'],
  동아리: ['동아리'],
  기타: [],
};
const BYTE_PRESETS = [1500, 900, 750];
const PER_SUBJECT = new Set(['세특', '동아리', '기타']);
const CONNECTIVES = ['이를 통해', '이러한', '또한', '뿐만 아니라', '나아가', '한편', '그리하여', '따라서', '그러므로', '이로써', '이에', '특히', '아울러', '더불어', '바탕으로', '계기로', '통하여', '결과적으로', '뿐만'];
const CONNECTIVE_RE = CONNECTIVES.map((c) => ({ c, re: new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') }));
const FREQ_STOP = new Set(['이를', '통해', '통한', '통하여', '대한', '대해', '위한', '위해', '하는', '있는', '되는', '했던', '보는', '같은', '등의', '등을', '으로', '에서', '그리고', '또한', '이러한', '바탕으로', '토대로', '과정', '가운데', '더욱', '매우', '그러한', '이와', '함께', '점을', '모습', '모습을', '모습이', '대하여', '있음', '있었', '하였', '되었', '하고', '으며', '하며']);

function inferCat(g) {
  g = g || '';
  if (g.includes('담임')) return '담임';
  if (g.includes('동아리')) return '동아리';
  return '세특';
}

function buildTargets() {
  const t = {};
  for (const cat of Object.keys(state.config.areas || {})) {
    for (const a of state.config.areas[cat] || []) t[a.area] = a.limit;
  }
  state.targets = t;
}

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

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1f2937;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .2s;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.opacity = '0'; }, 1900);
}

async function copyText(raw, area, label, limitArg) {
  const text = String(raw || '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  if (!text) { showToast('복사할 내용이 없습니다'); return; }
  try {
    await navigator.clipboard.writeText(text);
    const limit = limitArg != null ? limitArg : (state.targets[area] || 0);
    const b = calcBytes(text);
    const over = limit && b > limit ? ' ⚠ 한도초과' : '';
    showToast(`✓ ${label ? label + ' ' : ''}복사됨 · ${b}${limit ? '/' + limit : ''} byte${over} · NEIS에 붙여넣기`);
  } catch (e) {
    showToast('복사 실패 — 브라우저 권한 확인');
  }
}

function groupByteLimit(g) {
  const grp = (state.groupsList || []).find((x) => x.group_tag === g);
  if (grp && grp.byte_limit && PER_SUBJECT.has(grp.category)) return Number(grp.byte_limit);
  return null;
}

function activeLimit(area, g) {
  return groupByteLimit(g || state.group) || state.targets[area] || 0;
}

function copyArea() { return copyText($('#body').value, state.area, '', activeLimit(state.area)); }

async function boot() {
  state.config = await j('/api/config');
  state.forbidden = await j('/api/forbidden');
  try { state.spellIgnore = new Set(await j('/api/spell-ignore')); } catch (e) { state.spellIgnore = new Set(); }
  buildTargets();
  await refreshGroups();
  $('#body').addEventListener('input', () => {
    state.dirty = true;
    renderGauge();
    clearTimeout(state.assistTimer);
    state.assistTimer = setTimeout(renderAssist, 180);
  });
  $('#spellPanel').addEventListener('click', (ev) => {
    const more = ev.target.closest('.sp-more');
    if (more) { const i = Number(more.dataset.idx); if (state.spellErrors[i]) { state.spellErrors[i].helpOpen = !state.spellErrors[i].helpOpen; renderSpellPanel(); } return; }
    const apply = ev.target.closest('.sp-apply');
    if (apply) { applySpell(Number(apply.dataset.idx)); return; }
    const dismiss = ev.target.closest('.sp-dismiss');
    if (dismiss) { dismissSpell(Number(dismiss.dataset.idx)); return; }
    if (ev.target.closest('.sp-cand')) return;
    const row = ev.target.closest('.spell-item');
    if (row) toggleSpellHighlight(Number(row.dataset.idx));
  });
  $('#spellPanel').addEventListener('change', (ev) => {
    const sel = ev.target.closest('.sp-cand');
    if (sel && state.spellErrors[Number(sel.dataset.idx)]) state.spellErrors[Number(sel.dataset.idx)].choice = sel.value;
  });
  $('#saveBtn').onclick = () => saveRecord();
  $('#statusChip').onclick = cycleStatus;
  $('#copyBtn').onclick = copyArea;
  $('#spellBtn').onclick = runSpell;
  $('#histBtn').onclick = openHistory;
  $('#histClose').onclick = closeHistory;
  $('#histModal').onclick = (e) => { if (e.target === $('#histModal')) closeHistory(); };
  $('#helpBtn').onclick = openHelp;
  $('#helpClose').onclick = closeHelp;
  $('#helpPrev').onclick = () => helpNav(-1);
  $('#helpNext').onclick = () => helpNav(1);
  $('#helpModal').onclick = (e) => { if (e.target === $('#helpModal')) closeHelp(); };
  $('#nextBtn').onclick = gotoNextUnwritten;
  $('#sentToggle').onclick = toggleSentMode;
  $('#dejoinBtn').onclick = dejoinBody;
  $('#vStudent').onclick = () => setView('student');
  $('#vDash').onclick = () => setView('dash');
  $('#vSettings').onclick = () => setView('settings');
  $('#dashFilter').onchange = renderDash;
  $('#dashExport').onclick = exportDash;
  $('#cfgSave').onclick = saveConfig;
  document.querySelectorAll('.settab').forEach((b) => { b.onclick = () => selectSetPane(b.dataset.t); });
  $('#tmplLink').onclick = downloadTemplate;
  $('#openFolderBtn').onclick = openDataFolder;
  $('#bakExportBtn').onclick = exportBackup;
  $('#bakImportBtn').onclick = importBackup;
  const dz = $('#dropzone');
  dz.onclick = () => $('#upFile').click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) previewUpload(f); };
  $('#upFile').onchange = (e) => { const f = e.target.files[0]; if (f) previewUpload(f); };
  $('#upAddStuBtn').onclick = addUpStudent;
  $('#upRegisterBtn').onclick = confirmUpload;
  $('#stuSearch').oninput = onSearch;
  $('#sortToggle').onclick = () => { state.sortUnwritten = !state.sortUnwritten; $('#sortToggle').textContent = state.sortUnwritten ? '미작성순' : '학번순'; renderTree(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  initUpdater();
  try { if (!localStorage.getItem('saengbu_onboarded')) { openHelp(); localStorage.setItem('saengbu_onboarded', '1'); } } catch (e) { /* ignore */ }
  if (!state.groupsList.length) { setView('settings'); return; }
  if (state.group) state.expanded.add(state.group);
  await loadList();
  setView('student');
}

async function refreshGroups() {
  const groups = await j('/api/groups');
  state.groupsList = groups;
  state.groupCat = {};
  for (const g of groups) state.groupCat[g.group_tag] = g.category;
  if (!state.group || !state.groupCat[state.group]) state.group = groups[0] ? groups[0].group_tag : null;
}

function setView(v) {
  state.view = v;
  $('#vStudent').classList.toggle('sel', v === 'student');
  $('#vDash').classList.toggle('sel', v === 'dash');
  $('#vSettings').classList.toggle('sel', v === 'settings');
  $('#dashView').hidden = v !== 'dash';
  $('#settingsView').hidden = v !== 'settings';
  $('#head').hidden = v !== 'student' || !state.hakbun;
  $('#tabs').hidden = v !== 'student' || !state.hakbun;
  $('#editor').hidden = v !== 'student' || !state.hakbun;
  $('#emptyState').hidden = !(v === 'student' && !state.hakbun);
  if (v === 'student' && !state.hakbun) updateEmptyState();
  refreshView();
}

function refreshView() {
  if (state.view === 'dash') renderDash();
  else if (state.view === 'settings') renderSettings();
}

async function loadGroup(g) {
  state.studsByGroup[g] = await j('/api/students?group=' + encodeURIComponent(g));
  return state.studsByGroup[g];
}

async function loadList() {
  if (state.group) await loadGroup(state.group);
  state.listCache = state.studsByGroup[state.group] || [];
  renderTree();
  if (state.view === 'student' && !state.hakbun) updateEmptyState();
}

function progRatio(s) {
  const p = s.prog;
  if (!p || !p.total) return -1;
  return p.done / p.total;
}

function sortStuds(list) {
  if (state.sortUnwritten) {
    return list.sort((a, b) => progRatio(a) - progRatio(b) || String(a.hakbun).localeCompare(String(b.hakbun)));
  }
  return list.sort((a, b) => String(a.hakbun).localeCompare(String(b.hakbun)));
}

function progBadge(s, isOpen) {
  if (isOpen && state.view === 'student' && state.area && state.curStatus) {
    return `<span class="badge prog-chip ${state.curStatus}" title="현재 영역 ${esc(state.area)} 상태 · 클릭해 순환">${esc(state.area)} ${state.curStatus}</span>`;
  }
  const p = s.prog;
  if (!p || !p.total) return `<span class="badge prog-chip 미작성" title="열린 학생이면 클릭해 현재 영역 상태 순환">${esc(s.status || '미작성')}</span>`;
  const st = p.done >= p.total ? '완료' : (p.started ? '초안' : '미작성');
  return `<span class="badge prog-chip ${st}" title="완료 ${p.done} / 전체 ${p.total} · 열린 학생이면 클릭해 현재 영역 순환">${st} ${p.done}/${p.total}</span>`;
}

function renderStuds(tag, q) {
  let list = state.studsByGroup[tag];
  if (!list) return state.expanded.has(tag) ? '<li class="loading">불러오는 중…</li>' : '';
  list = sortStuds(list.filter((s) => !q || (`${s.hakbun} ${s.name}`).toLowerCase().includes(q)));
  if (!list.length) return q ? '<li class="empty">결과 없음</li>' : '<li class="empty">학생 없음</li>';
  return list.map((s) => {
    const isOpen = s.hakbun === state.hakbun && tag === state.group;
    return `<li data-h="${esc(s.hakbun)}" data-g="${esc(tag)}" class="${isOpen ? 'sel' : ''}">
       <span class="nm">${esc(s.hakbun)} ${esc(s.name)}</span>
       ${progBadge(s, isOpen)}</li>`;
  }).join('');
}

function renderTree() {
  const q = ($('#stuSearch').value || '').trim().toLowerCase();
  const tree = $('#groupTree');
  tree.innerHTML = state.groupsList.map((g) => {
    const tag = g.group_tag;
    if (q) {
      const studs = state.studsByGroup[tag] || [];
      if (!studs.some((s) => (`${s.hakbun} ${s.name}`).toLowerCase().includes(q))) return '';
    }
    const exp = state.expanded.has(tag) || !!q;
    const active = tag === state.group ? ' active' : '';
    return `<div class="grp">
      <div class="grp-head${active}" data-g="${esc(tag)}">
        <span class="caret">${exp ? '▾' : '▸'}</span>
        <span class="grp-name"><span class="grp-cat">(${esc(g.category)})</span> ${esc(tag)}</span>
        <span class="grp-n">${g.n}</span>
        <button class="grp-add" data-g="${esc(tag)}" title="학생 추가">＋</button>
      </div>
      <ul class="grp-students" ${exp ? '' : 'hidden'}>${exp ? renderStuds(tag, q) : ''}</ul>
    </div>`;
  }).join('') || '<div class="empty" style="padding:14px">그룹 없음 — 설정에서 명단을 올리세요</div>';

  tree.querySelectorAll('.grp-head').forEach((h) => {
    h.onclick = (e) => { if (e.target.closest('.grp-add')) return; toggleGroup(h.dataset.g); };
  });
  tree.querySelectorAll('.grp-add').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); addStudent(b.dataset.g); }; });
  tree.querySelectorAll('li[data-h]').forEach((li) => { li.onclick = () => onStudentClick(li.dataset.h, li.dataset.g); });
  tree.querySelectorAll('li[data-h] .prog-chip').forEach((chip) => {
    chip.onclick = (e) => {
      const li = chip.closest('li');
      if (state.view === 'student' && state.area && state.hakbun === li.dataset.h && state.group === li.dataset.g) {
        e.stopPropagation();
        cycleStatus();
      }
    };
  });
}

function onStudentClick(hakbun, group) {
  if (state.view === 'dash') {
    state.group = group;
    state.expanded.add(group);
    const after = () => { state.listCache = state.studsByGroup[group] || []; renderTree(); refreshView(); };
    if (!state.studsByGroup[group]) loadGroup(group).then(after); else after();
    return;
  }
  openStudent(hakbun, group);
}

async function toggleGroup(tag) {
  state.group = tag;
  if (state.expanded.has(tag)) {
    state.expanded.delete(tag);
  } else {
    state.expanded.add(tag);
    if (!state.studsByGroup[tag]) await loadGroup(tag);
    state.listCache = state.studsByGroup[tag] || [];
  }
  renderTree();
  if (state.view !== 'student') refreshView();
}

async function onSearch() {
  const q = ($('#stuSearch').value || '').trim();
  if (q) {
    const missing = state.groupsList.filter((g) => !state.studsByGroup[g.group_tag]);
    if (missing.length) await Promise.all(missing.map((g) => loadGroup(g.group_tag)));
  }
  renderTree();
}

function updateEmptyState() {
  const hasGroups = Object.keys(state.groupCat).length > 0;
  const hasStudents = (state.listCache || []).length > 0;
  if (!hasGroups) {
    $('#emptyTitle').textContent = '시작하려면 설정에서 명단을 올리세요';
    $('#emptyMsg').innerHTML = '아직 등록된 그룹이 없습니다. <b>설정 탭</b>에서 분류별 영역을 정하고 학생 명단(xlsx/csv)을 업로드하세요.';
  } else if (!hasStudents) {
    $('#emptyTitle').textContent = '이 그룹에 학생이 없습니다';
    $('#emptyMsg').innerHTML = '<b>+학생</b>으로 추가하거나, <b>설정 탭</b>에서 명단을 업로드하세요.';
  } else {
    $('#emptyTitle').textContent = '학생을 선택하세요';
    $('#emptyMsg').innerHTML = '왼쪽 목록에서 학생을 고르세요. 검색·정렬로 빠르게 찾을 수 있습니다.';
  }
}

async function addStudent(group) {
  const g = group || state.group;
  if (!g) return;
  const hakbun = ((await askText('추가할 학생의 학번', '')) || '').trim(); if (!hakbun) return;
  const name = ((await askText('학생 이름', '')) || '').trim();
  await j('/api/students', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hakbun, name, group_tag: g }) });
  state.group = g;
  state.expanded.add(g);
  await loadList();
}

function catFor(g) {
  return state.groupCat[g] || inferCat(g);
}

function areasFor(g) {
  const cat = catFor(g);
  return (state.config.areas[cat] || []).map((a) => a.area);
}

async function openStudent(hakbun, group) {
  await saveIfDirty();
  if (group) { state.group = group; state.expanded.add(group); state.listCache = state.studsByGroup[group] || state.listCache; }
  state.hakbun = hakbun;
  state.student = await j('/api/students/' + hakbun);
  setView('student');
  const g = state.group || '';
  const s = state.student;
  $('#headInfo').innerHTML = `${esc(s.hakbun)} ${esc(s.name)}<span class="sub">(${esc(catFor(g))}) ${esc(g)}${(s.groups || []).length > 1 ? ' · 소속 ' + esc((s.groups || []).join(', ')) : ''}</span>`;
  const areas = areasFor(g);
  $('#tabs').innerHTML = areas.map((a) => `<button data-a="${esc(a)}">${esc(a)}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => { b.onclick = async () => { await saveIfDirty(); selectArea(b.dataset.a); }; });
  loadList();
  selectArea(areas[0]);
}

const STATUS_CYCLE = ['미작성', '초안', '검증', '완료'];

function setStatusChip(st) {
  state.curStatus = STATUS_CYCLE.includes(st) ? st : '미작성';
  const el = $('#statusChip');
  if (el) { el.textContent = state.curStatus; el.className = 'status-chip badge ' + state.curStatus; }
}

function cycleStatus() {
  if (!state.hakbun || !state.area) return;
  const i = STATUS_CYCLE.indexOf(state.curStatus || '미작성');
  setStatusChip(STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length]);
  saveRecord(true);
  showToast('상태: ' + state.curStatus);
}

function selectArea(area) {
  state.area = area;
  state.subject = PER_SUBJECT.has(catFor(state.group)) ? (state.group || '') : '';
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.a === area));
  const rec = (state.student.records || []).find((r) => r.area === area && r.subject === state.subject) || {};
  $('#body').value = rec.body || '';
  setStatusChip(rec.status || '미작성');
  state.spellErrors = []; state.spellHlIdx = null; state.spellBaseText = ''; state.spellUndo = null;
  showEdit();
  renderAssist();
  $('#spellPanel').innerHTML = '<div class="empty">‘맞춤법’ 버튼을 눌러 점검</div>';
  state.dirty = false;
  renderTree();
}

async function gotoNextUnwritten() {
  const list = state.listCache.length ? state.listCache : await j('/api/students?group=' + encodeURIComponent(state.group || ''));
  const idx = list.findIndex((s) => s.hakbun === state.hakbun);
  const order = list.slice(idx + 1).concat(list.slice(0, idx + 1));
  const incomplete = (s) => !s.prog || s.prog.done < s.prog.total;
  const next = order.find(incomplete) || order.find((s) => s.hakbun !== state.hakbun);
  if (next) openStudent(next.hakbun, state.group);
}

function renderGauge() {
  const text = $('#body').value;
  const limit = activeLimit(state.area) || 0;
  const bytes = calcBytes(text);
  const pct = limit ? (bytes / limit) * 100 : 0;
  const cls = bytes > limit ? 'over' : pct >= 95 ? 'full' : pct < 70 ? 'low' : 'ok';
  $('.gauge').className = 'gauge ' + cls;
  $('#gaugeFill').style.width = Math.min(100, pct) + '%';
  $('#gaugeArea').textContent = `${state.area}${state.subject ? ' · ' + state.subject : ''}`;
  $('#gaugeText').textContent = `${[...text].length}자 · ${bytes} / ${limit} B (${pct.toFixed(0)}%)`;
  return { bytes, limit, pct, cls };
}

function renderAssist() {
  const text = $('#body').value;
  renderGauge();
  renderFreq(text);
  if (state.sentMode) renderSentences(text);
}

function splitSentences(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?\n]*(?:[.!?]+|\n|$)/g) || [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

function markTerm(s, term, cls) {
  return term ? esc(s).split(esc(term)).join(`<mark class="${cls || 'hl'}">${esc(term)}</mark>`) : esc(s);
}

function renderSentences(text) {
  const sents = splitSentences(text);
  if (!sents.length) { $('#sentView').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  const term = state.hlTerm;
  const cls = state.hlClass || 'hl';
  let head = '';
  if (term) {
    const count = text.split(term).length - 1;
    head = `<div class="hl-head">‘<b>${esc(term)}</b>’ ${count}회 강조 · <button class="hl-clear" type="button">강조 해제</button></div>`;
  }
  const body = sents.map((s, i) => {
    const n = [...s].length;
    const long = n > 120;
    const veryLong = n > 160;
    const scls = veryLong ? 'sent vlong' : long ? 'sent long' : 'sent';
    return `<div class="${scls}"><span class="sno">${i + 1}</span><span class="stx">${markTerm(s, term, cls)}</span><span class="slen">${n}자 · ${calcBytes(s)}B</span></div>`;
  }).join('');
  $('#sentView').innerHTML = head + body;
  const clr = $('#sentView').querySelector('.hl-clear');
  if (clr) clr.onclick = () => { state.hlTerm = null; if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); } renderSentences($('#body').value); };
}

function showEdit() {
  state.sentMode = false; state.hlMode = false; state.hlTerm = null;
  if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); }
  $('#body').hidden = false; $('#sentView').hidden = true;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
}

function toggleSentMode() {
  if (state.sentMode || state.hlMode) { showEdit(); return; }
  state.sentMode = true; state.hlTerm = null;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
  $('#body').hidden = true; $('#sentView').hidden = false;
  renderSentences($('#body').value);
}

function dejoinBody() {
  const before = $('#body').value;
  const after = before.replace(/[ \t]*\r?\n[ \t]*/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (after === before) { showToast('제거할 줄바꿈이 없습니다'); return; }
  $('#body').value = after;
  state.dirty = true;
  if (state.sentMode || state.hlMode) showEdit();
  renderAssist();
  showToast('✓ 줄바꿈 제거됨');
}

function highlightTerm(term, markClass) {
  if (!term) return;
  const mc = markClass || 'hl';
  if (state.sentMode) { state.hlTerm = term; state.hlClass = mc; renderSentences($('#body').value); return; }
  state.hlMode = true; state.sentMode = false; state.hlTerm = term; state.hlClass = mc;
  const text = $('#body').value;
  const html = esc(text).split(esc(term)).join(`<mark class="${mc}">${esc(term)}</mark>`);
  const count = text.split(term).length - 1;
  const toSent = mc === 'hl' ? ' <button class="hl-tosent" type="button">문장별 보기 ▸</button>' : '';
  $('#sentView').innerHTML = `<div class="hl-head">‘<b>${esc(term)}</b>’ ${count}곳 강조 — 편집하려면 ‘편집으로’${toSent}</div><div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
  const ts = $('#sentView').querySelector('.hl-tosent');
  if (ts) ts.onclick = () => { state.sentMode = true; state.hlMode = false; renderSentences($('#body').value); };
}

function renderFreq(text) {
  const t = String(text || '');
  const conn = CONNECTIVE_RE
    .map(({ c, re }) => ({ c, n: (t.match(re) || []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const words = {};
  for (const m of t.match(/[가-힣]{2,}/g) || []) { if (!FREQ_STOP.has(m)) words[m] = (words[m] || 0) + 1; }
  const top = Object.entries(words).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);

  let html = '';
  if (conn.length) {
    html += '<div class="freq-grp"><div class="ft">연결어·상투어</div>'
      + conn.map((x) => `<span class="chip clickable ${x.n >= 3 ? 'hot' : ''}" data-term="${esc(x.c)}">${esc(x.c)} ${x.n}</span>`).join('') + '</div>';
  }
  if (top.length) {
    html += '<div class="freq-grp"><div class="ft">반복 단어</div>'
      + top.map(([w, n]) => `<span class="chip clickable ${n >= 4 ? 'hot' : ''}" data-term="${esc(w)}">${esc(w)} ${n}</span>`).join('') + '</div>';
  }
  $('#freqPanel').innerHTML = html || '<div class="empty">반복 표현 없음</div>';
  $('#freqPanel').querySelectorAll('.chip.clickable').forEach((c) => { c.onclick = () => highlightTerm(c.dataset.term); });
}

const SPELL_HELP_MAX = 80;

async function runSpell() {
  const text = $('#body').value.trim();
  if (!text) { $('#spellPanel').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  if (state.spellHlIdx != null) showEdit();
  state.spellErrors = []; state.spellHlIdx = null;
  $('#spellPanel').innerHTML = '<div class="empty">부산대 검사기로 검사 중…</div>';
  try {
    const r = await fetch('/api/spellcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const d = await r.json();
    if (!r.ok) { $('#spellPanel').innerHTML = `<div class="warn-item err"><span class="ico">⚠</span><span>검사 실패 — ${esc(d.error || '연결 오류')}</span></div>`; return; }
    const errs = (d.errors || []).filter((e) => !state.spellIgnore.has(e.orig));
    state.spellErrors = errs.map((e) => ({ ...e, choice: (e.suggest || [])[0] || '', helpOpen: false }));
    state.spellBaseText = $('#body').value;
    renderSpellPanel();
    const ignored = (d.errors || []).length - errs.length;
    showToast(`맞춤법 의심 ${errs.length}건${ignored ? ` · 무시 ${ignored}` : ''}`);
  } catch (e) {
    $('#spellPanel').innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>검사기 연결 실패 — 인터넷 확인</span></div>';
  }
}

function spellHelpHtml(e, idx) {
  const help = e.help || '';
  if (!help) return '';
  if ([...help].length <= SPELL_HELP_MAX || e.helpOpen) {
    const more = [...help].length > SPELL_HELP_MAX ? ` <button class="sp-more" data-idx="${idx}">접기</button>` : '';
    return `<div class="sp-help">${esc(help)}${more}</div>`;
  }
  const cut = [...help].slice(0, SPELL_HELP_MAX).join('');
  return `<div class="sp-help collapsed">${esc(cut)}… <button class="sp-more" data-idx="${idx}">더보기</button></div>`;
}

function renderSpellPanel() {
  const live = state.spellErrors.filter(Boolean);
  if (!live.length) {
    $('#spellPanel').innerHTML = '<div class="warn-item ok"><span class="ico">●</span><span>맞춤법 의심 없음 (또는 모두 처리됨)</span></div>';
    return;
  }
  const rows = state.spellErrors.map((e, idx) => {
    if (!e) return '';
    const cands = e.suggest || [];
    const sug = cands.length > 1
      ? `<select class="sp-cand" data-idx="${idx}">${cands.map((c) => `<option value="${esc(c)}" ${c === e.choice ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
      : `<span class="sp-sug">${esc(cands[0] || '-')}</span>`;
    const apply = cands.length ? `<button class="sp-apply" data-idx="${idx}">반영</button>` : '';
    return `<div class="spell-item${idx === state.spellHlIdx ? ' sel' : ''}" data-idx="${idx}">
      <div class="sp-top"><span class="sp-orig">${esc(e.orig)}</span><span class="sp-arrow">→</span>${sug}</div>
      ${spellHelpHtml(e, idx)}
      <div class="sp-actions">${apply}<button class="sp-dismiss" data-idx="${idx}">미반영</button></div>
    </div>`;
  }).join('');
  $('#spellPanel').innerHTML = `<div class="muted spell-count" style="margin-bottom:6px">${live.length}건 · 행 클릭 시 본문 강조</div>${rows}`;
}

function markSpellActive() {
  document.querySelectorAll('#spellPanel .spell-item').forEach((el) => {
    el.classList.toggle('sel', Number(el.dataset.idx) === state.spellHlIdx);
  });
}

function toggleSpellHighlight(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  if (state.spellHlIdx === idx) { showEdit(); return; }
  const text = $('#body').value;
  if (!text.includes(e.orig)) { showToast('본문에서 찾을 수 없음 — 검사 후 본문이 바뀌었을 수 있어요'); return; }
  state.spellHlIdx = idx;
  highlightTerm(e.orig, 'hl spell-err');
  markSpellActive();
}

function showAppliedOverlay(term) {
  state.hlMode = true; state.sentMode = false; state.hlTerm = term; state.spellHlIdx = null;
  const text = $('#body').value;
  const html = esc(text).split(esc(term)).join(`<mark class="hl spell-fixed">${esc(term)}</mark>`);
  $('#sentView').innerHTML = `<div class="hl-head">✓ ‘<b>${esc(term)}</b>’(으)로 반영됨 — 편집하려면 ‘편집으로’</div><div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
  markSpellActive();
}

function showOverlayPlain() {
  state.hlMode = true; state.sentMode = false; state.hlTerm = null; state.spellHlIdx = null;
  const text = $('#body').value;
  $('#sentView').innerHTML = `<div class="hl-head">검토 보기 — 편집하려면 ‘편집으로’</div><div class="hlview">${esc(text)}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
  markSpellActive();
}

function applySpell(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  const cand = e.choice || (e.suggest || [])[0] || '';
  if (!cand) return;
  const cur = $('#body').value;
  if (state.spellBaseText && cur !== state.spellBaseText) {
    showToast('본문이 검사 후 수정됨 — 다시 검사해 주세요');
    return;
  }
  const pos = cur.indexOf(e.orig);
  if (pos < 0) { showToast('본문에서 찾을 수 없음'); return; }
  state.spellUndo = { idx, text: cur };
  const next = cur.slice(0, pos) + cand + cur.slice(pos + e.orig.length);
  $('#body').value = next;
  state.spellBaseText = next;
  state.dirty = true;
  renderAssist();
  removeSpellRow(idx);
  showAppliedOverlay(cand);
  showToastUndo(`✓ '${e.orig}' → '${cand}' 반영 (저장 시 기록)`);
}

function showToastUndo(msg) {
  let t = document.getElementById('toast');
  showToast(msg);
  if (t) {
    const b = document.createElement('button');
    b.textContent = '되돌리기';
    b.style.cssText = 'margin-left:10px;background:#374151;color:#fff;border:1px solid #6b7280;border-radius:6px;padding:1px 8px;cursor:pointer;font-size:12px';
    b.onclick = () => {
      if (!state.spellUndo) return;
      $('#body').value = state.spellUndo.text;
      state.spellBaseText = state.spellUndo.text;
      state.dirty = true; showEdit(); renderAssist();
      state.spellUndo = null;
      showToast('되돌렸습니다');
    };
    t.appendChild(b);
  }
}

async function dismissSpell(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  const wasHl = state.spellHlIdx === idx;
  state.spellIgnore.add(e.orig);
  removeSpellRow(idx);
  if (wasHl) showOverlayPlain();
  try {
    const list = await j('/api/spell-ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ word: e.orig }) });
    state.spellIgnore = new Set(list);
  } catch (err) { /* local set already updated */ }
  showToast(`'${e.orig}' 무시 목록에 추가됨 (이후 검사에서 제외)`);
}

function removeSpellRow(idx) {
  state.spellErrors[idx] = null;
  renderSpellPanel();
}

function diffWords(a, b) {
  const tok = (s) => (String(s || '').match(/\s+|[가-힣a-zA-Z0-9]+|[^\s]/g)) || [];
  const A = tok(a), B = tok(b);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) dp[i][k] = A[i] === B[k] ? dp[i + 1][k + 1] + 1 : Math.max(dp[i + 1][k], dp[i][k + 1]);
  let i = 0, k = 0, out = '';
  while (i < n && k < m) {
    if (A[i] === B[k]) { out += esc(A[i]); i++; k++; }
    else if (dp[i + 1][k] >= dp[i][k + 1]) { out += `<del>${esc(A[i])}</del>`; i++; }
    else { out += `<ins>${esc(B[k])}</ins>`; k++; }
  }
  while (i < n) { out += `<del>${esc(A[i])}</del>`; i++; }
  while (k < m) { out += `<ins>${esc(B[k])}</ins>`; k++; }
  return out.replace(/\n/g, '<br>');
}

async function openHistory() {
  if (!state.hakbun || !state.area) return;
  const edits = await j(`/api/history/${state.hakbun}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`);
  const versions = [];
  if (edits.length) {
    versions.push({ date: edits[0].created_at, text: edits[0].before });
    for (const e of edits) versions.push({ date: e.created_at, text: e.after });
  } else {
    versions.push({ date: '현재', text: $('#body').value });
  }
  state.histVersions = versions;
  renderHistory();
  $('#histModal').hidden = false;
}

function renderHistory() {
  const vs = state.histVersions || [];
  const rows = vs.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
    const isCurrent = i === vs.length - 1;
    const diff = i > 0 ? diffWords(vs[i - 1].text, v.text) : esc(v.text).replace(/\n/g, '<br>');
    const label = i === 0 ? ' · 최초' : '';
    const right = isCurrent ? '<span class="ver-badge">현재</span>' : `<button class="ver-restore" data-idx="${i}">이 버전으로</button>`;
    return `<div class="ver-item${isCurrent ? ' current' : ''}">
      <div class="ver-top"><span class="ver-date">${esc(v.date)}${label}</span>${right}</div>
      <div class="ver-diff">${diff || '<span class="muted">(빈 본문)</span>'}</div></div>`;
  }).join('');
  $('#histBody').innerHTML = rows || '<div class="empty">이력 없음</div>';
  $('#histBody').querySelectorAll('.ver-restore').forEach((b) => { b.onclick = () => restoreVersion(Number(b.dataset.idx)); });
}

async function restoreVersion(idx) {
  const v = (state.histVersions || [])[idx];
  if (!v) return;
  $('#body').value = v.text;
  state.dirty = true;
  await saveRecord(true);
  closeHistory();
  showEdit();
  renderAssist();
  showToast('✓ 이 버전으로 복구됨 (이력 보존)');
}

function closeHistory() { $('#histModal').hidden = true; }

const HELP_PAGES = [
  { t: '환영합니다 👋', h: `
    <p class="help-lead">생기부 입력 도우미는 <b>학기별 생기부를 빠르게 입력하고 점검</b>하도록 돕는 프로그램이에요.</p>
    <p>글은 선생님이 쓰고, <b>바이트 세기·맞춤법·반복 표현·진행 관리</b>처럼 번거로운 일은 프로그램이 맡습니다. NEIS에 붙여넣기 직전, 마지막 점검까지 도와드려요.</p>
    <p class="help-note">🔒 모든 데이터는 <b>이 컴퓨터에만</b> 저장됩니다. 맞춤법 검사를 누를 때만 본문이 외부(부산대 검사기)로 전송돼요.</p>
    <p class="help-tip">오른쪽 아래 <b>다음 ▶</b> 을 눌러 한 장씩 따라와 보세요.</p>` },
  { t: '1단계 · 무엇을 쓸지 정하기 (설정)', h: `
    <p>맨 위 <b>설정</b> 탭에서, 분류마다 작성할 영역과 글자 수(바이트) 한도를 정합니다.</p>
    <ul>
      <li><b>담임교사</b> — 자율·자치활동, 진로활동, 행동특성</li>
      <li><b>교과 담당교사</b> — 세부능력및특기사항(세특)</li>
      <li><b>동아리 담당교사</b> — 동아리활동</li>
    </ul>
    <p>특정 반만 한도가 다르면(예: <b>1학년 통합과학 세특 750바이트</b>) <b>등록 현황·관리</b> 탭에서 그 반만 따로 바꿀 수 있어요.</p>` },
  { t: '2단계 · 학생 명단 올리기', h: `
    <p><b>설정 ▸ 명단 업로드</b>에서 이렇게 하면 됩니다.</p>
    <ol>
      <li>위쪽에서 양식 시트를 고르고 <b>양식 다운로드</b></li>
      <li>채운 엑셀을 <b>왼쪽 칸에 끌어다 놓기</b></li>
      <li>오른쪽 미리보기에서 학번·이름을 <b>그 자리에서 수정</b>하거나 <b>+ 학생 추가</b></li>
      <li><b>등록하기</b></li>
    </ol>
    <p>시트 이름(담임/세특/동아리/기타)과 열(과목명·분반·동아리명)로 분류와 그룹이 자동으로 정해져요. 학번은 자릿수 제한이 없습니다.</p>` },
  { t: '3단계 · 쓰고 점검하기', h: `
    <p>왼쪽에서 학생을 고르고 위쪽 영역 탭을 선택해 본문을 입력합니다.</p>
    <ul>
      <li>📏 <b>게이지</b> — 글자 수·바이트를 실시간으로 보여주고, 한도를 넘으면 빨갛게 알려줘요.</li>
      <li>🧹 <b>줄바꿈 제거</b> — PDF에서 긁어온 본문의 문장 중간 줄바꿈을 한 번에 정리합니다.</li>
      <li>🔁 <b>표현 빈도</b> — 반복 단어·상투어를 세고, 누르면 본문에 노란 형광으로 표시 + <b>문장별 보기</b>로 바로 넘어갈 수 있어요.</li>
      <li>✂️ <b>문장별 보기</b> — 문장 단위로 끊어 보고 너무 긴 문장을 표시해 줍니다.</li>
    </ul>` },
  { t: '4단계 · 맞춤법과 이력', h: `
    <ul>
      <li>🔍 <b>맞춤법</b> — 부산대 검사기로 점검해요. 결과 줄을 누르면 본문에서 그 부분이 강조되고, <b>반영</b>은 제안대로 고치고 <b>미반영</b>은 무시 목록에 넣어 다음부터 빼줍니다.</li>
      <li>🕘 <b>이력 보기</b> — 저장 기록을 단어 단위로 비교하고 이전 버전으로 되돌릴 수 있어요(원본은 지워지지 않습니다).</li>
      <li>📋 <b>복사</b> — 본문을 복사해 NEIS 입력란에 <b>Ctrl+V</b>로 붙여넣기.</li>
    </ul>
    <p class="help-note">단축키 — 저장 <b>Ctrl+S</b> · 다음 미작성 <b>Ctrl+→</b></p>` },
  { t: '5단계 · 진행 관리와 백업', h: `
    <ul>
      <li>🏷️ <b>상태 칩</b> — 학생·영역마다 미작성 → 초안 → 검증 → 완료를 클릭으로 순환시켜 표시해요.</li>
      <li>📊 <b>대시보드</b> — 반 전체 진행률을 보고, 작성한 내용을 <b>엑셀로 내보내기</b> 할 수 있어요.</li>
      <li>💾 <b>암호화 백업</b> — 설정 ▸ 데이터·백업에서 비밀번호로 내보내, 다른 PC에서 같은 비밀번호로 불러오면 그대로 이어집니다. (비밀번호를 잊으면 복원할 수 없어요.)</li>
    </ul>
    <p class="help-lead">처음 5분만 설정하면, 그다음부터는 ‘쓰고 → 점검하고 → 붙여넣기’가 훨씬 가벼워집니다. 🙂</p>` },
];

function renderHelp() {
  const i = state.helpPage || 0;
  const p = HELP_PAGES[i];
  $('#helpBody').innerHTML = `<div class="help-page"><h4>${p.t}</h4>${p.h}</div>`;
  $('#helpDots').innerHTML = HELP_PAGES.map((_, k) => `<span class="help-dot${k === i ? ' on' : ''}" data-k="${k}"></span>`).join('');
  $('#helpPrev').style.visibility = i === 0 ? 'hidden' : 'visible';
  $('#helpNext').textContent = i === HELP_PAGES.length - 1 ? '시작하기 ✓' : '다음 ▶';
  $('#helpBody').scrollTop = 0;
  $('#helpDots').querySelectorAll('.help-dot').forEach((d) => { d.onclick = () => { state.helpPage = Number(d.dataset.k); renderHelp(); }; });
}

function helpNav(d) {
  const last = HELP_PAGES.length - 1;
  if (d > 0 && (state.helpPage || 0) >= last) { closeHelp(); return; }
  state.helpPage = Math.max(0, Math.min(last, (state.helpPage || 0) + d));
  renderHelp();
}

function openHelp() { state.helpPage = 0; renderHelp(); $('#helpModal').hidden = false; }
function closeHelp() { $('#helpModal').hidden = true; }

function askText(label, def) {
  return new Promise((resolve) => {
    $('#promptTitle').textContent = label;
    const inp = $('#promptInput');
    inp.value = def || '';
    $('#promptModal').hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const cleanup = () => { $('#promptOk').onclick = null; $('#promptCancel').onclick = null; inp.onkeydown = null; };
    const done = (v) => { $('#promptModal').hidden = true; cleanup(); resolve(v); };
    $('#promptOk').onclick = () => done(inp.value);
    $('#promptCancel').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); else if (e.key === 'Escape') done(null); };
  });
}

function showUpd(msg, percent, ready) {
  $('#updBanner').hidden = false;
  $('#updMsg').textContent = msg;
  $('#updTrack').hidden = ready || percent == null;
  if (percent != null) $('#updFill').style.width = Math.min(100, percent) + '%';
  $('#updRestart').hidden = !ready;
}

function initUpdater() {
  if (!window.updater) return;
  $('#updRestart').onclick = () => window.updater.restart();
  $('#updClose').onclick = () => { $('#updBanner').hidden = true; };
  window.updater.onAvailable((d) => showUpd(`새 버전 ${d.version || ''} 발견 — 다운로드 준비 중…`, 0, false));
  window.updater.onProgress((d) => showUpd(`업데이트 다운로드 중… ${Math.round(d.percent || 0)}%`, d.percent || 0, false));
  window.updater.onDownloaded((d) => showUpd(`새 버전 ${d.version || ''} 준비 완료 — 재시작하면 적용됩니다`, 100, true));
}

async function exportBackup() {
  const pw = $('#bakExpPw').value;
  if (!pw || pw.length < 4) { $('#bakMsg').textContent = '백업 비밀번호는 4자 이상이어야 합니다'; return; }
  $('#bakMsg').textContent = '백업 만드는 중…';
  try {
    const r = await fetch('/api/backup/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const d = await r.json();
    if (!r.ok) { $('#bakMsg').textContent = d.error || '내보내기 실패'; return; }
    const blob = new Blob([JSON.stringify(d)], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `생기부백업_${new Date().toISOString().slice(0, 10)}.sbbak`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#bakExpPw').value = '';
    $('#bakMsg').textContent = '✓ 암호화 백업 파일을 저장했습니다 (비밀번호 분실 시 복원 불가)';
  } catch (e) { $('#bakMsg').textContent = '내보내기 실패'; }
}

async function importBackup() {
  const f = $('#bakImpFile').files[0];
  const pw = $('#bakImpPw').value;
  if (!f) { $('#bakMsg').textContent = '백업 파일을 선택하세요'; return; }
  if (!pw) { $('#bakMsg').textContent = '백업 비밀번호를 입력하세요'; return; }
  if (!confirm('현재 데이터를 백업 내용으로 덮어씁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
  let env;
  try { env = JSON.parse(await f.text()); } catch { $('#bakMsg').textContent = '백업 파일을 읽을 수 없습니다'; return; }
  $('#bakMsg').textContent = '복원 중…';
  try {
    const r = await fetch('/api/backup/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw, envelope: env }) });
    const d = await r.json();
    if (!r.ok) { $('#bakMsg').textContent = d.error || '불러오기 실패'; return; }
    $('#bakImpPw').value = '';
    $('#bakMsg').textContent = '✓ 복원 완료 — 새로고침합니다';
    setTimeout(() => location.reload(), 900);
  } catch (e) { $('#bakMsg').textContent = '불러오기 실패'; }
}

async function openDataFolder() {
  $('#folderMsg').textContent = '여는 중…';
  try {
    const r = await fetch('/api/open-folder', { method: 'POST' });
    const d = await r.json();
    $('#folderMsg').textContent = r.ok ? '✓ 폴더를 열었습니다' : (d.error || '열기 실패');
  } catch (e) {
    $('#folderMsg').textContent = '열기 실패';
  }
  setTimeout(() => { $('#folderMsg').textContent = ''; }, 3000);
}

async function saveRecord(silent) {
  if (!state.hakbun || !state.area) return false;
  const url = `/api/records/${state.hakbun}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`;
  try {
    const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: $('#body').value, status: state.curStatus || '미작성' }) });
    if (!r.ok) { showToast('저장 실패 — 잠시 후 다시 시도하세요 (입력은 유지됨)'); return false; }
    state.student = await r.json();
    state.dirty = false;
    await loadList();
    if (!silent) showToast('✓ 저장됨');
    return true;
  } catch (e) {
    showToast('저장 실패 — 연결을 확인하세요 (입력은 유지됨)');
    return false;
  }
}

async function saveIfDirty() {
  if (state.dirty && state.hakbun && state.area) await saveRecord(true);
}

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (state.hakbun) saveRecord(); }
  else if (mod && e.key === 'ArrowRight') { e.preventDefault(); if (state.hakbun) gotoNextUnwritten(); }
}

async function renderDash() {
  const d = await j('/api/dashboard?group=' + encodeURIComponent(state.group || ''));
  $('#dashProg').innerHTML =
    `<div class="progbar"><div class="fill" style="width:${d.completion}%"></div></div>
     <div class="summary">완료율 <b>${d.completion}%</b> · 완료 <b>${d.summary['완료']}</b> · 검증 <b>${d.summary['검증']}</b> · 초안 <b>${d.summary['초안']}</b> · 미작성 <b>${d.summary['미작성']}</b></div>`;
  const filter = $('#dashFilter').value;
  dashBodies = {};
  const fillCls = (c) => c.status === '미작성' && !c.bytes ? 'none' : (c.pct > 100 ? 'over' : c.pct >= 95 ? 'full' : c.pct < 70 ? 'low' : 'ok');
  const head = '<tr><th>복사</th><th>학번</th><th>이름</th><th>영역</th><th>진행</th><th>바이트</th><th>쓰기</th></tr>';
  const rows = d.rows.map((r) => {
    const n = r.cells.length;
    return r.cells.map((c, i) => {
      const key = `${r.hakbun}|${c.area}|${c.subject || ''}`;
      const hasText = (c.body || '').trim().length > 0;
      if (hasText) dashBodies[key] = c.body;
      const lim = c.limit || state.targets[c.area] || 0;
      const dim = filter && c.status !== filter ? ' dim' : '';
      const copyBtn = hasText
        ? `<button class="cell-copy" data-key="${esc(key)}" data-area="${esc(c.area)}" data-lim="${lim}" title="${esc(c.area)} 복사">복사</button>`
        : '<span class="row-copy-empty">–</span>';
      const writeBtn = `<button class="gowrite" data-h="${esc(r.hakbun)}" data-g="${esc(state.group)}" data-a="${esc(c.area)}">쓰러 가기 ▶</button>`;
      const who = i === 0
        ? `<td class="hakbun" rowspan="${n}">${esc(r.hakbun)}</td><td class="sname" rowspan="${n}">${esc(r.name)}</td>`
        : '';
      return `<tr class="arow-tr ${fillCls(c)}${dim}${i === 0 ? ' stu-first' : ''}">`
        + `<td class="copycol">${copyBtn}</td>${who}`
        + `<td class="alabel">${esc(c.area)}</td>`
        + `<td class="barcol"><div class="dbar"><div class="dfill" style="width:${Math.min(100, c.pct)}%"></div></div></td>`
        + `<td class="abytes">${c.bytes} / ${lim} B</td>`
        + `<td class="writecol">${writeBtn}</td></tr>`;
    }).join('');
  }).join('');
  $('#dashTable').innerHTML = `<table class="dash flat">${head}${rows}</table>`;
  $('#dashTable').querySelectorAll('.cell-copy').forEach((b) => {
    b.onclick = () => copyText(dashBodies[b.dataset.key], b.dataset.area, '', Number(b.dataset.lim) || null);
  });
  $('#dashTable').querySelectorAll('.gowrite').forEach((b) => {
    b.onclick = () => openWrite(b.dataset.h, b.dataset.g, b.dataset.a);
  });
}

async function openWrite(hakbun, group, area) {
  await openStudent(hakbun, group);
  if (area) selectArea(area);
}

async function exportDash() {
  const group = state.group;
  if (!group) { showToast('그룹을 먼저 선택하세요'); return; }
  const d = await j('/api/dashboard?group=' + encodeURIComponent(group));
  if (!d.rows.length) { showToast('내보낼 학생이 없습니다'); return; }
  const head = ['학번', '이름', ...d.areas];
  const aoa = [head];
  for (const r of d.rows) {
    const row = [r.hakbun, r.name];
    for (const area of d.areas) {
      const c = r.cells.find((x) => x.area === area);
      row.push(c ? (c.body || '') : '');
    }
    aoa.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 11 }, { wch: 10 }, ...d.areas.map(() => ({ wch: 60 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '생기부');
  XLSX.writeFile(wb, `생기부_${group}.xlsx`);
  showToast(`✓ ${d.rows.length}명 엑셀로 내보냈습니다`);
}


function byteSelect(area, limit) {
  const isPreset = BYTE_PRESETS.includes(limit);
  const opts = BYTE_PRESETS.map((p) => `<option value="${p}" ${limit === p ? 'selected' : ''}>${p}</option>`).join('')
    + `<option value="custom" ${!isPreset ? 'selected' : ''}>직접입력</option>`;
  return `<select class="cfg-byte" data-area="${esc(area)}">${opts}</select>`
    + `<input class="cfg-custom" data-area="${esc(area)}" type="number" min="1" value="${esc(limit)}" ${isPreset ? 'hidden' : ''} />`;
}

function selectSetPane(t) {
  document.querySelectorAll('.settab').forEach((x) => x.classList.toggle('sel', x.dataset.t === t));
  document.querySelectorAll('.setpane').forEach((p) => { p.hidden = p.dataset.pane !== t; });
}

function renderSettings() {
  const cats = state.config.categories || [];
  $('#cfgCards').innerHTML = cats.map((cat) => {
    const list = state.config.areas[cat] || [];
    const byKey = {};
    for (const a of list) byKey[a.area] = a.limit;
    const title = CAT_LABEL[cat] || cat;
    if (cat === '기타') {
      const custom = list.map((a) => customRow(cat, a.area, a.limit)).join('');
      return `<div class="cfg-card" data-cat="${esc(cat)}">
        <h3>${esc(title)}</h3><div class="cfg-custom-list">${custom}</div>
        <button class="cfg-add btn-ghost" data-cat="${esc(cat)}">+ 직접 영역</button>
      </div>`;
    }
    const rows = (CATEGORY_AREAS[cat] || []).map((key) => {
      const on = byKey[key] != null;
      const lim = on ? byKey[key] : 1500;
      return `<div class="cfg-row" data-cat="${esc(cat)}">
        <label class="cfg-check"><input type="checkbox" class="cfg-on" data-area="${esc(key)}" ${on ? 'checked' : ''}/> ${esc(AREA_LABEL[key] || key)} <small>(${esc(key)})</small></label>
        <span class="cfg-byte-wrap" ${on ? '' : 'hidden'}>${byteSelect(key, lim)}</span>
      </div>`;
    }).join('');
    return `<div class="cfg-card" data-cat="${esc(cat)}"><h3>${esc(title)}</h3>${rows}</div>`;
  }).join('');

  $('#cfgCards').querySelectorAll('.cfg-on').forEach((cb) => {
    cb.onchange = () => { cb.closest('.cfg-row').querySelector('.cfg-byte-wrap').hidden = !cb.checked; };
  });
  $('#cfgCards').querySelectorAll('.cfg-byte').forEach(bindByteSelect);
  $('#cfgCards').querySelectorAll('.cfg-add').forEach((b) => {
    b.onclick = () => {
      const wrap = b.closest('.cfg-card').querySelector('.cfg-custom-list');
      wrap.insertAdjacentHTML('beforeend', customRow(b.dataset.cat, '', 1500));
      const row = wrap.lastElementChild;
      bindByteSelect(row.querySelector('.cfg-byte'));
      row.querySelector('.cfg-del').onclick = () => row.remove();
    };
  });
  $('#cfgCards').querySelectorAll('.cfg-del').forEach((b) => { b.onclick = () => b.closest('.cfg-row').remove(); });

  renderManage();
}

function renderManage() {
  const gs = state.groupsList || [];
  if (!gs.length) { $('#managePanel').innerHTML = '<div class="empty">등록된 그룹이 없습니다</div>'; return; }
  state.mgExpanded = state.mgExpanded || new Set();
  const total = gs.reduce((s, g) => s + (g.n || 0), 0);
  let html = `<div class="mg-sum">그룹 ${gs.length} · 학생 ${total}명</div>`;
  for (const cat of (state.config.categories || [])) {
    const list = gs.filter((g) => g.category === cat);
    if (!list.length) continue;
    html += `<div class="mg-cat-h">${esc(cat)}</div>`;
    for (const g of list) {
      const exp = state.mgExpanded.has(g.group_tag);
      html += `<div class="mg-grp">
        <div class="mg-row">
          <button class="mg-caret" data-g="${esc(g.group_tag)}">${exp ? '▾' : '▸'}</button>
          <span class="mg-name">${esc(g.group_tag)}</span>
          <span class="mg-n">${g.n}명</span>
          ${groupByteControl(g)}
          <span class="spacer"></span>
          <button class="mg-rename btn-ghost" data-g="${esc(g.group_tag)}">이름변경</button>
          <button class="mg-del btn-ghost" data-g="${esc(g.group_tag)}">삭제</button>
        </div>
        <div class="mg-students" ${exp ? '' : 'hidden'}>${exp ? renderMgStudents(g.group_tag) : ''}</div>
      </div>`;
    }
  }
  $('#managePanel').innerHTML = html;
  $('#managePanel').querySelectorAll('.mg-byte').forEach((sel) => { sel.onchange = () => setGroupByteUI(sel.dataset.g, sel.value); });
  $('#managePanel').querySelectorAll('.mg-caret').forEach((b) => { b.onclick = () => toggleMg(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-rename').forEach((b) => { b.onclick = () => renameGroupUI(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-del').forEach((b) => { b.onclick = () => deleteGroupUI(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-remove').forEach((b) => { b.onclick = () => removeMemberUI(b.dataset.h, b.dataset.g); });
}

function groupByteControl(g) {
  if (!PER_SUBJECT.has(g.category)) return '';
  const cur = Number(g.byte_limit) || '';
  const presets = BYTE_PRESETS.map((p) => `<option value="${p}" ${cur === p ? 'selected' : ''}>${p}B</option>`).join('');
  return `<select class="mg-byte" data-g="${esc(g.group_tag)}" title="이 그룹만 다른 바이트 한도 (예: 1학년 세특 750)">
      <option value="" ${!cur ? 'selected' : ''}>설정값</option>${presets}
    </select>`;
}

async function setGroupByteUI(tag, val) {
  const r = await fetch(`/api/groups/${encodeURIComponent(tag)}/byte`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ byte_limit: val === '' ? null : Number(val) }) });
  const d = await r.json();
  if (!r.ok) { showToast(d.error || '저장 실패'); return; }
  await refreshGroups();
  if (state.view === 'student' && state.group === tag) renderGauge();
  showToast(val === '' ? '✓ 설정값 사용' : `✓ ${val}B 한도 적용`);
}

function renderMgStudents(tag) {
  const list = state.studsByGroup[tag];
  if (!list) return '<div class="muted">불러오는 중…</div>';
  if (!list.length) return '<div class="muted">학생 없음</div>';
  return list.map((s) => `<div class="mg-stu"><span>${esc(s.hakbun)} ${esc(s.name)}</span><button class="mg-remove btn-ghost" data-h="${esc(s.hakbun)}" data-g="${esc(tag)}">빼기</button></div>`).join('');
}

async function toggleMg(tag) {
  state.mgExpanded = state.mgExpanded || new Set();
  if (state.mgExpanded.has(tag)) state.mgExpanded.delete(tag);
  else { state.mgExpanded.add(tag); if (!state.studsByGroup[tag]) await loadGroup(tag); }
  renderManage();
}

async function renameGroupUI(tag) {
  const nn = await askText('새 그룹명', tag);
  if (!nn || !nn.trim() || nn.trim() === tag) return;
  const r = await fetch(`/api/groups/${encodeURIComponent(tag)}/rename`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newTag: nn.trim() }) });
  const d = await r.json();
  if (!r.ok) { showToast(d.error || '변경 실패'); return; }
  delete state.studsByGroup[tag];
  await refreshGroups(); renderSettings(); await loadList();
  showToast('✓ 그룹명 변경됨');
}

async function deleteGroupUI(tag) {
  if (!confirm(`'${tag}' 그룹을 삭제할까요?\n다른 그룹에 없는 소속 학생과 그 기록도 함께 삭제됩니다. 되돌릴 수 없습니다.`)) return;
  await j(`/api/groups/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  delete state.studsByGroup[tag];
  state.mgExpanded.delete(tag);
  await refreshGroups(); renderSettings(); await loadList();
  showToast('✓ 그룹 삭제됨');
}

async function removeMemberUI(hakbun, tag) {
  if (!confirm(`${hakbun} 학생을 '${tag}'에서 뺄까요?\n작성한 기록은 보존됩니다. (다른 그룹에도 없고 작성 내용이 전혀 없을 때만 학생이 정리됩니다)`)) return;
  await j(`/api/students/${encodeURIComponent(hakbun)}/membership/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  await loadGroup(tag); await refreshGroups(); renderManage(); await loadList();
}

function customRow(cat, area, limit) {
  return `<div class="cfg-row custom" data-cat="${esc(cat)}">
    <input type="text" class="cfg-name" placeholder="영역명" value="${esc(area)}" />
    <span class="cfg-byte-wrap">${byteSelect(area || '__new__', limit)}</span>
    <button class="cfg-del btn-ghost">✕</button>
  </div>`;
}

function bindByteSelect(sel) {
  sel.onchange = () => {
    const custom = sel.parentElement.querySelector('.cfg-custom');
    if (custom) custom.hidden = sel.value !== 'custom';
  };
}

function readRowLimit(row) {
  const sel = row.querySelector('.cfg-byte');
  if (!sel) return 0;
  if (sel.value === 'custom') return Number(row.querySelector('.cfg-custom').value) || 0;
  return Number(sel.value) || 0;
}

async function saveConfig() {
  const areas = {};
  for (const cat of state.config.categories) areas[cat] = [];
  $('#cfgCards').querySelectorAll('.cfg-card').forEach((card) => {
    const cat = card.dataset.cat;
    card.querySelectorAll('.cfg-row:not(.custom)').forEach((row) => {
      const on = row.querySelector('.cfg-on');
      if (on && on.checked) areas[cat].push({ area: on.dataset.area, limit: readRowLimit(row) });
    });
    card.querySelectorAll('.cfg-row.custom').forEach((row) => {
      const name = (row.querySelector('.cfg-name').value || '').trim();
      if (name) areas[cat].push({ area: name, limit: readRowLimit(row) });
    });
  });
  state.config = await j('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ areas }) });
  buildTargets();
  $('#cfgMsg').textContent = '✓ 저장됨';
  setTimeout(() => { $('#cfgMsg').textContent = ''; }, 1800);
}

const HMAP = {
  학번: '학번', 학번호: '학번', 학적번호: '학번', studentid: '학번', id: '학번',
  이름: '이름', 성명: '이름', name: '이름',
  과목명: '과목명', 과목: '과목명', 교과: '과목명', 강좌명: '과목명', 강좌: '과목명',
  분반: '분반', 반: '분반', 그룹: '분반', 그룹명: '분반',
  동아리명: '동아리명', 동아리: '동아리명', 부서: '동아리명',
  구분: '구분', 분류: '구분',
};
function canonKeyOf(k) {
  const nk = String(k == null ? '' : k).replace(/\s+/g, '');
  return HMAP[nk] || HMAP[nk.toLowerCase()] || null;
}
function looksHeader(cells) {
  return cells.map((c) => String(c == null ? '' : c).replace(/\s+/g, '')).some((c) => HMAP[c] || HMAP[c.toLowerCase()]);
}
function rowsFromAoa(aoa) {
  const rows = (aoa || []).filter((r) => Array.isArray(r) && r.some((c) => String(c == null ? '' : c).trim()));
  if (!rows.length) return [];
  if (looksHeader(rows[0])) {
    const cols = rows[0].map(canonKeyOf);
    return rows.slice(1).map((row) => {
      const o = {};
      cols.forEach((c, i) => { if (c && o[c] == null) o[c] = row[i]; });
      return o;
    });
  }
  // headerless → positional: 학번, 이름
  return rows.map((row) => ({ 학번: row[0], 이름: row[1] }));
}
function aoaFromSheet(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
}

const CAT_LIST = ['담임', '세특', '동아리', '기타'];
function inferCatFromRows(rows) {
  const keys = new Set();
  rows.slice(0, 8).forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  if (keys.has('과목명')) return '세특';
  if (keys.has('동아리명')) return '동아리';
  if (keys.has('구분')) return '기타';
  return '담임';
}

// returns [{category, rows}] — one per category sheet (or column-inferred for ad-hoc files)
function parseFileSheets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const out = [];
        for (const name of wb.SheetNames) {
          const rows = rowsFromAoa(aoaFromSheet(wb.Sheets[name]));
          if (!rows.length) continue;
          const cat = CAT_LIST.includes(name) ? name : inferCatFromRows(rows);
          out.push({ category: cat, rows });
        }
        resolve(out);
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

const TMPL_COLS = {
  담임: ['학번', '이름'],
  세특: ['과목명', '분반', '학번', '이름'],
  동아리: ['동아리명', '학번', '이름'],
  기타: ['구분', '학번', '이름'],
};
const TMPL_EX = {
  담임: [['30401', '홍길동'], ['30402', '김철수']],
  세특: [['고급생명과학', '01', '30401', '홍길동'], ['고급생명과학', '02', '30415', '이영희']],
  동아리: [['과학탐구반', '30401', '홍길동']],
  기타: [['멘토링', '30401', '홍길동']],
};

function rowGroup(cat, r, fallback) {
  const g = (k) => String(r[k] != null ? r[k] : '').trim();
  if (cat === '세특') { const s = g('과목명'); const b = g('분반'); const jn = s ? (b ? `${s} ${b}` : s) : ''; return jn || fallback; }
  if (cat === '동아리') return g('동아리명') || fallback;
  if (cat === '기타') return g('구분') || fallback;
  return fallback;
}

function downloadTemplate() {
  const checked = [...document.querySelectorAll('.tmpl-cat:checked')].map((c) => c.value);
  const cats = checked.length ? checked : (state.config.categories || ['담임', '세특', '동아리', '기타']);
  const wb = XLSX.utils.book_new();
  for (const cat of cats) {
    const ws = XLSX.utils.aoa_to_sheet([TMPL_COLS[cat], ...TMPL_EX[cat]]);
    ws['!cols'] = TMPL_COLS[cat].map(() => ({ wch: 13 }));
    XLSX.utils.book_append_sheet(wb, ws, cat);
  }
  XLSX.writeFile(wb, '생기부-학생명단-템플릿.xlsx');
}

function buildCombined(sheets) {
  const groups = {};
  let noHakbun = 0; let noGroup = 0;
  for (const { category, rows } of sheets) {
    const fallback = category === '담임' ? '우리반' : '';
    for (const r of rows) {
      const hakbun = String(r['학번'] != null ? r['학번'] : (r.hakbun || '')).trim();
      if (!hakbun) { noHakbun += 1; continue; }
      const grp = rowGroup(category, r, fallback);
      if (!grp) { noGroup += 1; continue; }
      const key = `${category}|${grp}`;
      if (!groups[key]) groups[key] = { category, group: grp, students: [] };
      groups[key].students.push({ hakbun, name: String(r['이름'] || r.name || '').trim() });
    }
  }
  return { groups, noHakbun, noGroup };
}

function resetUpPreview(msg) {
  state.pendingUpload = null;
  $('#upGroupTabs').innerHTML = '';
  $('#upRegisterBtn').hidden = true;
  $('#upAddStuBtn').hidden = true;
  $('#upPreviewList').innerHTML = msg
    ? `<div class="empty">등록할 학생 0명 — ${esc(msg)}</div>`
    : '<div class="empty">왼쪽에 파일을 올리면 그룹·명단이 미리보기됩니다</div>';
  $('#upPrevSum').textContent = '';
  $('#upMsg').textContent = '';
}

async function previewUpload(file) {
  if (!file) return;
  $('#upMsg').textContent = '읽는 중…';
  let sheets;
  try { sheets = await parseFileSheets(file); } catch (e) { $('#upMsg').textContent = '파싱 실패: ' + e.message; return; }
  showCombinedPreview(buildCombined(sheets));
}

function showCombinedPreview({ groups, noHakbun, noGroup }) {
  const keys = Object.keys(groups);
  if (!keys.length) {
    resetUpPreview(noGroup ? '그룹 열(과목명/동아리명/구분) 또는 담임 시트를 확인하세요' : '학번 열을 확인하세요');
    return;
  }
  state.pendingUpload = groups;
  state.upActive = keys[0];
  state.upExcluded = (noHakbun || 0) + (noGroup || 0);
  $('#upRegisterBtn').hidden = false;
  $('#upAddStuBtn').hidden = false;
  $('#upMsg').textContent = '';
  renderUpTabs();
  renderUpList();
}

function renderUpTabs() {
  const groups = state.pendingUpload || {};
  const keys = Object.keys(groups);
  const total = keys.reduce((s, k) => s + groups[k].students.length, 0);
  const ex = state.upExcluded ? ` · 제외 ${state.upExcluded}` : '';
  $('#upPrevSum').textContent = keys.length ? `${keys.length}개 그룹 · ${total}명${ex}` : '';
  $('#upGroupTabs').innerHTML = keys.map((k) =>
    `<button class="up-tab ${k === state.upActive ? 'sel' : ''}" data-k="${esc(k)}">${esc(groups[k].group)} <span class="up-tab-n">${groups[k].students.length}</span></button>`).join('');
  $('#upGroupTabs').querySelectorAll('.up-tab').forEach((b) => { b.onclick = () => { state.upActive = b.dataset.k; renderUpTabs(); renderUpList(); }; });
}

function renderUpList() {
  const groups = state.pendingUpload || {};
  const g = groups[state.upActive];
  if (!g) { $('#upPreviewList').innerHTML = ''; return; }
  const rows = g.students.map((s, i) =>
    `<tr>`
    + `<td><input class="up-in" data-i="${i}" data-f="hakbun" value="${esc(s.hakbun)}" placeholder="학번" /></td>`
    + `<td><input class="up-in" data-i="${i}" data-f="name" value="${esc(s.name)}" placeholder="이름" /></td>`
    + `<td><button class="up-rm" data-i="${i}" title="행 삭제">✕</button></td></tr>`).join('');
  $('#upPreviewList').innerHTML = `<div class="up-list-head"><span class="up-cat">(${esc(g.category)})</span> <b>${esc(g.group)}</b> · ${g.students.length}명</div>`
    + '<table class="up-tbl edit"><thead><tr><th>학번</th><th>이름</th><th></th></tr></thead><tbody>'
    + rows + '</tbody></table>';
  $('#upPreviewList').querySelectorAll('.up-in').forEach((inp) => {
    inp.oninput = () => { g.students[Number(inp.dataset.i)][inp.dataset.f] = inp.value.trim(); };
  });
  $('#upPreviewList').querySelectorAll('.up-rm').forEach((b) => {
    b.onclick = () => { g.students.splice(Number(b.dataset.i), 1); renderUpTabs(); renderUpList(); };
  });
}

function addUpStudent() {
  const groups = state.pendingUpload;
  if (!groups) return;
  const g = groups[state.upActive];
  if (!g) return;
  g.students.push({ hakbun: '', name: '' });
  renderUpTabs();
  renderUpList();
  const ins = $('#upPreviewList').querySelectorAll('.up-in[data-f="hakbun"]');
  if (ins.length) ins[ins.length - 1].focus();
}

async function confirmUpload() {
  const groups = state.pendingUpload;
  if (!groups) return;
  $('#upRegisterBtn').disabled = true;
  let total = 0;
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    const students = g.students.filter((s) => String(s.hakbun || '').trim());
    if (!students.length) continue;
    const res = await j('/api/students/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group_tag: g.group, category: g.category, students }) });
    total += res.added;
  }
  $('#upRegisterBtn').disabled = false;
  $('#upRegisterBtn').hidden = true;
  $('#upAddStuBtn').hidden = true;
  state.pendingUpload = null;
  $('#upFile').value = '';
  $('#upGroupTabs').innerHTML = '';
  $('#upPreviewList').innerHTML = `<div class="empty">✓ ${total}명 등록 완료</div>`;
  $('#upPrevSum').textContent = '';
  showToast(`✓ ${total}명 등록됨`);
  await refreshGroups();
  await loadList();
  if (state.view === 'settings') renderManage();
}

boot();
