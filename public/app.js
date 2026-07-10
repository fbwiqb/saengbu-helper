const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HSEP = String.fromCharCode(31);
const dispH = (h) => { const s = String(h == null ? '' : h); const i = s.lastIndexOf(HSEP); return i >= 0 ? s.slice(i + 1) : s; };
let state = { group: null, hakbun: null, area: null, subject: '', targets: {}, forbidden: [], student: null, view: 'student', listCache: [], config: { categories: [], areas: {} }, groupCat: {}, sentMode: false, dirty: false, groupsList: [], expanded: new Set(), studsByGroup: {}, sortMode: 'hakbun', hlMode: false, hlTerm: null, hlClass: 'hl', hlSpacing: false, sentParts: [], spellErrors: [], spellBaseText: '', spellIgnore: new Set(), spellHlIdx: null, spellUndo: null, forbid: [], forbidHlIdx: null, forbidBaseText: '' };
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
const CONNECTIVES = ['이를 통해', '이러한', '또한', '뿐만 아니라', '나아가', '한편', '그리하여', '따라서', '그러므로', '이로써', '이에', '특히', '아울러', '더불어', '바탕으로', '계기로', '통하여', '결과적으로', '뿐만', '주제'];
const FREQ_WATCH = new Set(['주제']);
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
  for (const cat of PER_SUBJECT) if (!(cat in t)) t[cat] = 1500;
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
  try { state.spellIgnore = new Set(await j('/api/spell-ignore')); } catch (e) { state.spellIgnore = new Set(); }
  try { state.phrases = await j('/api/common-phrases'); } catch (e) { state.phrases = []; }
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
  $('#fbdPanel').addEventListener('click', (ev) => {
    const apply = ev.target.closest('.fbd-apply');
    if (apply) { applyForbid(Number(apply.dataset.idx)); return; }
    const dismiss = ev.target.closest('.fbd-dismiss');
    if (dismiss) { dismissForbid(Number(dismiss.dataset.idx)); return; }
    const row = ev.target.closest('.fbd-item');
    if (row) toggleForbidHighlight(Number(row.dataset.idx));
  });
  $('#saveBtn').onclick = () => saveRecord();
  $('#statusChip').onclick = cycleStatus;
  $('#copyBtn').onclick = copyArea;
  $('#spellBtn').onclick = () => { runForbidden(); runSpell(); };
  $('#histBtn').onclick = openHistory;
  $('#histClose').onclick = closeHistory;
  $('#histModal').onclick = (e) => { if (e.target === $('#histModal')) closeHistory(); };
  $('#helpBtn').onclick = openHelp;
  $('#helpClose').onclick = closeHelp;
  $('#helpHide').onchange = (e) => { try { if (e.target.checked) localStorage.setItem('saengbu_help_hidden', '1'); else localStorage.removeItem('saengbu_help_hidden'); } catch (_) {} };
  $('#helpPrev').onclick = () => helpNav(-1);
  $('#helpNext').onclick = () => helpNav(1);
  $('#helpModal').onclick = (e) => { if (e.target === $('#helpModal')) closeHelp(); };
  $('#updNotes').onclick = openNotes;
  $('#notesClose').onclick = closeNotes;
  $('#notesModal').onclick = (e) => { if (e.target === $('#notesModal')) closeNotes(); };
  $('#nextBtn').onclick = gotoNextUnwritten;
  $('#sentToggle').onclick = toggleSentMode;
  $('#dejoinBtn').onclick = dejoinBody;
  $('#vStudent').onclick = () => setView('student');
  $('#vDash').onclick = () => setView('dash');
  $('#vSettings').onclick = () => setView('settings');
  $('#dashFilter').onchange = renderDash;
  $('#dashExport').onclick = openExport;
  $('#exportClose').onclick = closeExport;
  $('#exportCancel').onclick = closeExport;
  $('#exportModal').onclick = (e) => { if (e.target === $('#exportModal')) closeExport(); };
  $('#exportGo').onclick = runExport;
  $('#dashImport').onclick = () => $('#dashImportFile').click();
  $('#dashImportFile').onchange = (e) => { const f = e.target.files[0]; if (f) importDash(f); e.target.value = ''; };
  $('#cfgSave').onclick = saveConfig;
  document.querySelectorAll('.settab').forEach((b) => { b.onclick = () => selectSetPane(b.dataset.t); });
  $('#tmplLink').onclick = downloadTemplate;
  $('#openFolderBtn').onclick = openDataFolder;
  $('#resetDataBtn').onclick = resetData;
  $('#fbBug').onclick = () => openFb('bug');
  $('#fbFeat').onclick = () => openFb('feat');
  $('#fbClose').onclick = closeFb;
  $('#fbCancel').onclick = closeFb;
  $('#fbModal').onclick = (e) => { if (e.target === $('#fbModal')) closeFb(); };
  $('#fbSend').onclick = submitFb;
  $('#phraseAdd').onclick = phraseAdd;
  $('#phraseSave').onclick = phraseSave;
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
  $('#stuSearch').oninput = () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(onSearch, 140); };
  $('#sortSel').onchange = () => {
    state.sortMode = $('#sortSel').value;
    if (state.sortMode === 'custom') showToast('↕ 학생 이름을 드래그해 순서를 바꾸세요');
    renderTree();
  };
  document.addEventListener('keydown', onKey);
  Object.defineProperty(window, '__appDirty', { get: () => !!state.dirty });
  $('#quitBtn').onclick = () => window.close();
  initUpdater();
  try { if (!localStorage.getItem('saengbu_help_hidden') && !localStorage.getItem('saengbu_onboarded')) { openHelp(); localStorage.setItem('saengbu_onboarded', '1'); } } catch (e) { /* ignore */ }
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
  const byHak = (a, b) => String(a.disp || dispH(a.hakbun)).localeCompare(String(b.disp || dispH(b.hakbun)));
  if (state.sortMode === 'custom') {
    return list.sort((a, b) => ((a.ord == null ? Infinity : a.ord) - (b.ord == null ? Infinity : b.ord)) || byHak(a, b));
  }
  if (state.sortMode === 'unwritten') {
    return list.sort((a, b) => progRatio(a) - progRatio(b) || byHak(a, b));
  }
  if (state.sortMode === 'name') {
    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko') || byHak(a, b));
  }
  return list.sort(byHak);
}

function enableDrag(ul, group) {
  ul.querySelectorAll('li[data-h]').forEach((li) => {
    li.addEventListener('dragstart', (e) => { setTimeout(() => li.classList.add('dragging'), 0); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', li.dataset.h); } catch (_) {} });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); persistOrder(ul, group); });
  });
  ul.addEventListener('dragover', (e) => {
    e.preventDefault();
    const cur = ul.querySelector('li.dragging');
    if (!cur) return;
    const rest = [...ul.querySelectorAll('li[data-h]:not(.dragging)')];
    const after = rest.find((li) => { const r = li.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) ul.insertBefore(cur, after); else ul.appendChild(cur);
  });
}

async function persistOrder(ul, group) {
  const keys = [...ul.querySelectorAll('li[data-h]')].map((li) => li.dataset.h);
  const list = state.studsByGroup[group];
  if (list) {
    const byKey = {};
    for (const s of list) byKey[s.hakbun] = s;
    const reordered = keys.map((k) => byKey[k]).filter(Boolean);
    for (const s of list) if (!keys.includes(s.hakbun)) reordered.push(s);
    reordered.forEach((s, i) => { s.ord = i; });
    state.studsByGroup[group] = reordered;
    if (state.group === group) state.listCache = reordered;
  }
  try { await fetch('/api/students/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order: keys }) }); } catch (e) { /* noop */ }
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
  list = sortStuds(list.filter((s) => !q || (`${s.disp || dispH(s.hakbun)} ${s.name}`).toLowerCase().includes(q)));
  if (!list.length) return q ? '<li class="empty">결과 없음</li>' : '<li class="empty">학생 없음</li>';
  const custom = state.sortMode === 'custom';
  return list.map((s) => {
    const isOpen = s.hakbun === state.hakbun && tag === state.group;
    const handle = custom ? '<span class="drag-h" title="드래그해 순서 변경">⠿</span>' : '';
    return `<li data-h="${esc(s.hakbun)}" data-g="${esc(tag)}"${custom ? ' draggable="true"' : ''} class="${isOpen ? 'sel' : ''}${custom ? ' dragrow' : ''}">
       ${handle}<span class="nm">${esc(s.disp || dispH(s.hakbun))} ${esc(s.name)}</span>
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
      if (!studs.some((s) => (`${s.disp || dispH(s.hakbun)} ${s.name}`).toLowerCase().includes(q))) return '';
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
  if (state.sortMode === 'custom') {
    tree.querySelectorAll('.grp').forEach((grp) => {
      const head = grp.querySelector('.grp-head');
      const ul = grp.querySelector('.grp-students');
      if (head && ul) enableDrag(ul, head.dataset.g);
    });
  }
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
  const list = (state.config.areas[cat] || []).map((a) => a.area);
  if (!list.length && PER_SUBJECT.has(cat)) return [cat];
  return list;
}

async function openStudent(hakbun, group) {
  await saveIfDirty();
  if (group) { state.group = group; state.expanded.add(group); state.listCache = state.studsByGroup[group] || state.listCache; }
  state.hakbun = hakbun;
  state.student = await j('/api/students/' + encodeURIComponent(hakbun));
  setView('student');
  const g = state.group || '';
  const s = state.student;
  $('#headInfo').innerHTML = `${esc(s.disp || dispH(s.hakbun))} ${esc(s.name)}<span class="sub">(${esc(catFor(g))}) ${esc(g)}${(s.groups || []).length > 1 ? ' · 소속 ' + esc((s.groups || []).join(', ')) : ''}</span>`;
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
  state.forbid = []; state.forbidHlIdx = null; state.forbidBaseText = '';
  showEdit();
  renderAssist();
  renderPhraseButtons();
  $('#spellPanel').innerHTML = '<div class="empty">‘맞춤법’ 버튼을 눌러 점검</div>';
  $('#fbdPanel').innerHTML = '<div class="empty">‘맞춤법’ 버튼을 누르면 함께 검사</div>';
  state.dirty = false;
  renderTree();
}

async function gotoNextUnwritten() {
  await saveIfDirty();
  await loadList();
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

function sentenceParts(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n');
  if (!t) return [];
  return t.match(/[^.!?\n]*(?:[.!?]+|\n|$)/g) || [];
}

function markTerm(s, term, cls) {
  return term ? esc(s).split(esc(term)).join(`<mark class="${cls || 'hl'}">${esc(term)}</mark>`) : esc(s);
}

function markSpacing(s) {
  return esc(s).replace(/ {2,}/g, (m) => `<mark class="hl space-err">${'·'.repeat(m.length)}</mark>`);
}

function renderSentences(text) {
  const raw = sentenceParts(text);
  state.sentParts = raw;
  const term = state.hlTerm;
  const cls = state.hlClass || 'hl';
  const spacing = state.hlSpacing;
  let head = '';
  if (spacing) {
    const count = (text.match(/ {2,}/g) || []).length;
    head = `<div class="hl-head">이중 공백 ${count}곳 강조 · <button class="hl-clear" type="button">강조 해제</button></div>`;
  } else if (term) {
    const count = text.split(term).length - 1;
    head = `<div class="hl-head">‘<b>${esc(term)}</b>’ ${count}회 강조 · <button class="hl-clear" type="button">강조 해제</button></div>`;
  }
  let visible = 0;
  const rows = raw.map((s, i) => {
    if (!s.trim()) return '';
    visible += 1;
    const n = [...s.trim()].length;
    const long = n > 120;
    const veryLong = n > 160;
    const scls = veryLong ? 'sent vlong' : long ? 'sent long' : 'sent';
    const inner = spacing ? markSpacing(s) : markTerm(s, term, cls);
    return `<div class="${scls}"><span class="sno">${visible}</span><span class="stx" contenteditable="true" data-pi="${i}">${inner}</span><span class="slen">${n}자 · ${calcBytes(s.trim())}B</span></div>`;
  }).join('');
  if (!visible) { $('#sentView').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  $('#sentView').innerHTML = head + rows;
  const clr = $('#sentView').querySelector('.hl-clear');
  if (clr) clr.onclick = () => { state.hlTerm = null; state.hlSpacing = false; if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); } renderSentences($('#body').value); };
  $('#sentView').querySelectorAll('.stx[contenteditable]').forEach((el) => {
    el.addEventListener('focus', () => { const pi = Number(el.dataset.pi); el.textContent = state.sentParts[pi] != null ? state.sentParts[pi] : el.innerText; });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } });
    el.addEventListener('blur', () => commitSentence(el));
  });
}

function commitSentence(el) {
  const pi = Number(el.dataset.pi);
  if (!state.sentParts || pi >= state.sentParts.length) return;
  const next = el.innerText.replace(/\r\n?/g, '\n');
  if (next === state.sentParts[pi]) {
    if (state.hlSpacing) el.innerHTML = markSpacing(next);
    else if (state.hlTerm) el.innerHTML = markTerm(next, state.hlTerm, state.hlClass || 'hl');
    return;
  }
  state.sentParts[pi] = next;
  const body = state.sentParts.join('');
  $('#body').value = body;
  state.dirty = true;
  renderGauge();
  renderFreq(body);
  const reparsed = sentenceParts(body);
  const same = reparsed.length === state.sentParts.length && reparsed.every((p, i) => p === state.sentParts[i]);
  if (!same) { renderSentences(body); }
  else if (state.hlSpacing) { el.innerHTML = markSpacing(next); }
  else if (state.hlTerm) { el.innerHTML = markTerm(next, state.hlTerm, state.hlClass || 'hl'); }
}

function showEdit() {
  state.sentMode = false; state.hlMode = false; state.hlTerm = null; state.hlSpacing = false;
  if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); }
  if (state.forbidHlIdx != null) { state.forbidHlIdx = null; markForbidActive(); }
  $('#body').hidden = false; $('#sentView').hidden = true;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
}

function toggleSentMode() {
  if (state.sentMode) { showEdit(); return; }
  state.sentMode = true; state.hlMode = false;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '전체 보기';
  $('#body').hidden = true; $('#sentView').hidden = false;
  renderSentences($('#body').value);
}

function dejoinBody() {
  const before = $('#body').value;
  const after = before.replace(/[ \t]*\r?\n[ \t]*/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (after === before) { showToast('정리할 줄바꿈·이중 공백이 없습니다'); return; }
  $('#body').value = after;
  state.dirty = true;
  state.hlTerm = null; state.hlSpacing = false; state.spellHlIdx = null; markSpellActive();
  if (state.hlMode) showEdit();
  renderAssist();
  showToast('✓ 줄바꿈·이중 공백 정리됨');
}

function highlightTerm(term, markClass) {
  if (!term) return;
  const mc = markClass || 'hl';
  if (state.sentMode) { state.hlTerm = term; state.hlClass = mc; state.hlSpacing = false; renderSentences($('#body').value); return; }
  state.hlMode = true; state.sentMode = false; state.hlTerm = term; state.hlClass = mc;
  const text = $('#body').value;
  const html = esc(text).split(esc(term)).join(`<mark class="${mc}">${esc(term)}</mark>`);
  $('#sentView').innerHTML = `<div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
  const hv = $('#sentView').querySelector('.hlview');
  if (hv) hv.onclick = () => showEdit();
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
      + conn.map((x) => `<span class="chip clickable ${x.n >= 3 ? 'hot' : ''}${FREQ_WATCH.has(x.c) ? ' watch' : ''}" data-term="${esc(x.c)}">${esc(x.c)} ${x.n}</span>`).join('') + '</div>';
  }
  if (top.length) {
    html += '<div class="freq-grp"><div class="ft">반복 단어</div>'
      + top.map(([w, n]) => `<span class="chip clickable ${n >= 4 ? 'hot' : ''}" data-term="${esc(w)}">${esc(w)} ${n}</span>`).join('') + '</div>';
  }
  $('#freqPanel').innerHTML = html || '<div class="empty">반복 표현 없음</div>';
  $('#freqPanel').querySelectorAll('.chip.clickable').forEach((c) => { c.onclick = () => { if (state.hlMode && state.hlTerm === c.dataset.term) { showEdit(); return; } if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); } if (state.forbidHlIdx != null) { state.forbidHlIdx = null; markForbidActive(); } highlightTerm(c.dataset.term); }; });
}

const SPELL_HELP_MAX = 80;

async function runSpell() {
  const text = $('#body').value.trim();
  if (!text) { $('#spellPanel').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  if (state.spellHlIdx != null) {
    if (state.sentMode) { state.hlTerm = null; state.hlSpacing = false; renderSentences($('#body').value); }
    else showEdit();
  }
  state.spellErrors = []; state.spellHlIdx = null;
  const sp = ($('#body').value.match(/ {2,}/g) || []).length;
  const spacingItem = sp ? { kind: 'spacing', orig: `이중 공백 ${sp}곳`, suggest: ['한 칸으로'], choice: '한 칸으로', help: '연속으로 들어간 공백을 한 칸으로 정리합니다.', helpOpen: false } : null;
  $('#spellPanel').innerHTML = '<div class="empty">부산대 검사기로 검사 중…</div>';
  try {
    const r = await fetch('/api/spellcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '연결 오류');
    const errs = (d.errors || []).filter((e) => !state.spellIgnore.has(e.orig));
    state.spellErrors = errs.map((e) => ({ ...e, choice: (e.suggest || [])[0] || '', helpOpen: false }));
    if (spacingItem) state.spellErrors.unshift(spacingItem);
    state.spellBaseText = $('#body').value;
    renderSpellPanel();
    const ignored = (d.errors || []).length - errs.length;
    showToast(`맞춤법 의심 ${errs.length}건${sp ? ` · 이중 공백 ${sp}곳` : ''}${ignored ? ` · 무시 ${ignored}` : ''}`);
  } catch (e) {
    if (spacingItem) {
      state.spellErrors = [spacingItem];
      state.spellBaseText = $('#body').value;
      renderSpellPanel();
      $('#spellPanel').insertAdjacentHTML('afterbegin', '<div class="warn-item err" style="margin-bottom:6px"><span class="ico">⚠</span><span>맞춤법 검사기 연결 실패 — 이중 공백만 표시</span></div>');
      showToast(`이중 공백 ${sp}곳 · 맞춤법 검사 실패`);
    } else {
      $('#spellPanel').innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>맞춤법 검사기(외부 서비스)에 연결하지 못했습니다. 잠시 후 다시 시도하거나, 다른 네트워크(모바일 핫스팟 등)에서 시도해 보세요. — 나머지 기능은 정상 작동합니다.</span></div>';
    }
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
    const isSpacing = e.kind === 'spacing';
    let top;
    if (isSpacing) {
      top = `<div class="sp-top"><span class="sp-orig">${esc(e.orig)}</span></div>`;
    } else {
      const sug = cands.length > 1
        ? `<select class="sp-cand" data-idx="${idx}">${cands.map((c) => `<option value="${esc(c)}" ${c === e.choice ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
        : `<span class="sp-sug">${esc(cands[0] || '-')}</span>`;
      top = `<div class="sp-top"><span class="sp-orig">${esc(e.orig)}</span><span class="sp-arrow">→</span>${sug}</div>`;
    }
    const apply = cands.length ? `<button class="sp-apply" data-idx="${idx}">${isSpacing ? '한 칸으로' : '반영'}</button>` : '';
    return `<div class="spell-item${idx === state.spellHlIdx ? ' sel' : ''}" data-idx="${idx}">
      ${top}
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

function highlightSpacing() {
  state.hlMode = true; state.sentMode = false; state.hlTerm = null; state.hlClass = 'hl space-err';
  const text = $('#body').value;
  const re = / {2,}/g;
  let html = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    html += esc(text.slice(last, m.index));
    html += `<mark class="hl space-err">${'·'.repeat(m[0].length)}</mark>`;
    last = m.index + m[0].length;
  }
  html += esc(text.slice(last));
  $('#sentView').innerHTML = `<div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
  const hv = $('#sentView').querySelector('.hlview');
  if (hv) hv.onclick = () => showEdit();
}

function toggleSpellHighlight(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  if (state.forbidHlIdx != null) { state.forbidHlIdx = null; markForbidActive(); }
  if (state.spellHlIdx === idx && !state.sentMode) { showEdit(); return; }
  const text = $('#body').value;
  if (e.kind === 'spacing') {
    if (!/ {2,}/.test(text)) { showToast('본문에 이중 공백이 없음 — 검사 후 본문이 바뀌었을 수 있어요'); return; }
    state.spellHlIdx = idx;
    if (state.sentMode) { state.hlSpacing = true; state.hlTerm = null; renderSentences(text); }
    else highlightSpacing();
    markSpellActive();
    return;
  }
  if (!text.includes(e.orig)) { showToast('본문에서 찾을 수 없음 — 검사 후 본문이 바뀌었을 수 있어요'); return; }
  state.spellHlIdx = idx;
  highlightTerm(e.orig, 'hl spell-err');
  markSpellActive();
}

function showAppliedOverlay(term) {
  state.hlMode = true; state.sentMode = false; state.hlTerm = term; state.spellHlIdx = null;
  const text = $('#body').value;
  const html = esc(text).split(esc(term)).join(`<mark class="hl spell-fixed">${esc(term)}</mark>`);
  $('#sentView').innerHTML = `<div class="hl-head">✓ ‘<b>${esc(term)}</b>’(으)로 반영됨 · 본문을 누르면 편집 화면으로 돌아갑니다</div><div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
  const hv = $('#sentView').querySelector('.hlview');
  if (hv) hv.onclick = () => showEdit();
  markSpellActive();
}

function showOverlayPlain() {
  state.hlMode = true; state.sentMode = false; state.hlTerm = null; state.spellHlIdx = null;
  const text = $('#body').value;
  $('#sentView').innerHTML = `<div class="hl-head">검토 보기 · 본문을 누르면 편집 화면으로 돌아갑니다</div><div class="hlview">${esc(text)}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
  const hv = $('#sentView').querySelector('.hlview');
  if (hv) hv.onclick = () => showEdit();
  markSpellActive();
}

function applySpell(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  if (e.kind === 'spacing') {
    const cur0 = $('#body').value;
    if (state.spellBaseText && cur0 !== state.spellBaseText) { showToast('본문이 검사 후 수정됨 — 다시 검사해 주세요'); return; }
    state.spellUndo = { idx, text: cur0 };
    const next0 = cur0.replace(/ {2,}/g, ' ');
    $('#body').value = next0; state.spellBaseText = next0; state.dirty = true;
    state.hlTerm = null; state.hlSpacing = false; state.spellHlIdx = null;
    renderAssist(); removeSpellRow(idx);
    if (!state.sentMode) showOverlayPlain();
    showToastUndo('✓ 이중 공백 정리됨 (저장 시 기록)');
    return;
  }
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
  state.hlTerm = null; state.hlSpacing = false; state.spellHlIdx = null;
  renderAssist();
  removeSpellRow(idx);
  if (!state.sentMode) showAppliedOverlay(cand);
  showToastUndo(`✓ '${e.orig}' → '${cand}' 반영 (저장 시 기록)`);
}

function showToastUndo(msg) {
  showToast(msg);
  const t = document.getElementById('toast');
  if (t) {
    clearTimeout(showToast._t);
    const b = document.createElement('button');
    b.textContent = '되돌리기';
    b.style.cssText = 'margin-left:10px;background:#374151;color:#fff;border:1px solid #6b7280;border-radius:6px;padding:1px 8px;cursor:pointer;font-size:12px';
    b.onclick = () => {
      if (!state.spellUndo) return;
      $('#body').value = state.spellUndo.text;
      state.spellBaseText = state.spellUndo.text;
      state.dirty = true;
      state.hlTerm = null; state.hlSpacing = false; state.spellHlIdx = null;
      if (!state.sentMode) showEdit();
      renderAssist();
      state.spellUndo = null;
      showToast('되돌렸습니다');
    };
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = '닫기';
    x.style.cssText = 'margin-left:8px;background:transparent;color:#cbd5e1;border:none;cursor:pointer;font-size:13px';
    x.onclick = () => { t.style.opacity = '0'; };
    t.appendChild(b);
    t.appendChild(x);
  }
}

async function dismissSpell(idx) {
  const e = state.spellErrors[idx];
  if (!e) return;
  const wasHl = state.spellHlIdx === idx;
  state.spellIgnore.add(e.orig);
  removeSpellRow(idx);
  if (wasHl) {
    state.hlTerm = null; state.hlSpacing = false; state.spellHlIdx = null;
    if (state.sentMode) renderSentences($('#body').value);
    else showOverlayPlain();
  }
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

async function runForbidden() {
  const text = $('#body').value;
  if (!text.trim()) { $('#fbdPanel').innerHTML = '<div class="empty">본문이 비어 있음</div>'; state.forbid = []; state.forbidHlIdx = null; return; }
  $('#fbdPanel').innerHTML = '<div class="empty">기재금지 검사 중…</div>';
  try {
    const r = await fetch('/api/forbidden-scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const hits = await r.json();
    if (!r.ok) throw new Error('scan');
    state.forbid = (hits || []).map((h) => ({ ...h }));
    state.forbidBaseText = $('#body').value;
    state.forbidHlIdx = null;
    renderForbidPanel();
  } catch (e) {
    $('#fbdPanel').innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>기재금지 검사 실패</span></div>';
  }
}

function renderForbidPanel() {
  const live = state.forbid.filter(Boolean);
  if (!live.length) {
    $('#fbdPanel').innerHTML = '<div class="warn-item ok"><span class="ico">●</span><span>기재금지 표현 없음</span></div>';
    return;
  }
  const rows = state.forbid.map((h, idx) => {
    if (!h) return '';
    const rep = h.replace ? `<button class="fbd-apply" data-idx="${idx}">→ ${esc(h.replace)}</button>` : '';
    return `<div class="fbd-item${idx === state.forbidHlIdx ? ' sel' : ''}" data-idx="${idx}">
      <div class="fbd-top"><span class="fbd-term">🚫 ${esc(h.term)}</span><span class="fbd-cat">${esc(h.cat)}</span></div>
      <div class="fbd-reason">${esc(h.reason)}</div>
      <div class="fbd-actions">${rep}<button class="fbd-dismiss" data-idx="${idx}">무시</button></div>
    </div>`;
  }).join('');
  $('#fbdPanel').innerHTML = `<div class="muted spell-count" style="margin-bottom:6px">${live.length}건 · 행 클릭 시 본문 강조</div>${rows}`;
}

function markForbidActive() {
  document.querySelectorAll('#fbdPanel .fbd-item').forEach((el) => {
    el.classList.toggle('sel', Number(el.dataset.idx) === state.forbidHlIdx);
  });
}

function toggleForbidHighlight(idx) {
  const h = state.forbid[idx];
  if (!h) return;
  if (state.forbidHlIdx === idx && !state.sentMode) { showEdit(); return; }
  if (!$('#body').value.includes(h.term)) { showToast('본문에서 찾을 수 없음 — 검사 후 본문이 바뀌었을 수 있어요'); return; }
  if (state.spellHlIdx != null) { state.spellHlIdx = null; markSpellActive(); }
  state.forbidHlIdx = idx;
  highlightTerm(h.term, 'hl fbd-err');
  markForbidActive();
}

function applyForbid(idx) {
  const h = state.forbid[idx];
  if (!h || !h.replace) return;
  const cur = $('#body').value;
  if (state.forbidBaseText && cur !== state.forbidBaseText) { showToast('본문이 검사 후 수정됨 — 다시 검사해 주세요'); return; }
  const pos = cur.indexOf(h.term);
  if (pos < 0) { showToast('본문에서 찾을 수 없음'); return; }
  state.spellUndo = { idx: -1, text: cur };
  const next = cur.slice(0, pos) + h.replace + cur.slice(pos + h.term.length);
  $('#body').value = next; state.forbidBaseText = next; state.dirty = true;
  state.forbidHlIdx = null;
  renderAssist();
  removeForbidRow(idx);
  if (!state.sentMode) showEdit();
  showToastUndo(`✓ '${h.term}' → '${h.replace}' 반영 (저장 시 기록)`);
}

async function dismissForbid(idx) {
  const h = state.forbid[idx];
  if (!h) return;
  const wasHl = state.forbidHlIdx === idx;
  removeForbidRow(idx);
  if (wasHl) { state.forbidHlIdx = null; if (state.sentMode) renderSentences($('#body').value); else showEdit(); }
  try { await fetch('/api/forbidden-ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ word: h.term }) }); } catch (e) { /* noop */ }
  showToast(`'${h.term}' 무시 목록에 추가됨 (이후 검사에서 제외)`);
}

function removeForbidRow(idx) {
  state.forbid[idx] = null;
  renderForbidPanel();
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
  const edits = await j(`/api/history/${encodeURIComponent(state.hakbun)}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`);
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
    <p>글은 선생님이 쓰고, <b>바이트 세기·맞춤법·반복 표현·공통문구·진행 관리</b>처럼 번거로운 일은 프로그램이 맡습니다. NEIS에 붙여넣기 직전, 마지막 점검까지 도와드려요.</p>
    <p class="help-note">🔒 모든 데이터는 <b>이 컴퓨터에만</b> 저장됩니다. (맞춤법 검사를 누를 때만 본문이 검사기로 전송돼요.)</p>
    <p class="help-tip">오른쪽 아래 <b>다음 ▶</b> 을 눌러 한 장씩 따라와 보세요.</p>` },
  { t: '1단계 · 무엇을 쓸지 정하기 (설정)', h: `
    <p>맨 위 <b>설정</b> 탭에서, 분류마다 작성할 영역과 글자 수(바이트) 한도를 정합니다.</p>
    <ul>
      <li><b>담임교사</b> — 자율·자치활동, 진로활동, 행동특성</li>
      <li><b>교과 담당교사</b> — 세부능력및특기사항(세특)</li>
      <li><b>동아리 담당교사</b> — 동아리활동 / 그 밖은 <b>기타</b>로 직접 추가</li>
    </ul>
    <p>특정 반만 한도가 다르면(예: <b>1학년 통합과학 세특 750바이트</b>) <b>등록 현황·관리</b> 탭에서 그 그룹만 따로 바꿀 수 있어요. 프리셋(1500·900·750) 외 <b>직접입력</b>도 됩니다.</p>` },
  { t: '2단계 · 학생 명단 올리기', h: `
    <p><b>설정 ▸ 명단 업로드</b>에서 이렇게 하면 됩니다.</p>
    <ol>
      <li>내 역할(담임/세특/동아리/기타)을 체크하고 <b>양식 다운로드</b></li>
      <li>채운 엑셀을 <b>왼쪽 칸에 끌어다 놓기</b></li>
      <li>오른쪽 미리보기에서 학번·이름을 <b>그 자리에서 수정</b>하거나 <b>+ 학생 추가</b></li>
      <li><b>등록하기</b></li>
    </ol>
    <p>시트 이름(담임/세특/동아리/기타)과 열(과목명·분반·동아리명)로 분류와 그룹이 자동으로 정해져요. 학번은 자릿수 제한이 없습니다.</p>` },
  { t: '3단계 · 쓰고 점검하기', h: `
    <p>왼쪽에서 학생을 고르고 위쪽 영역 탭을 선택해 본문을 입력합니다.</p>
    <ul>
      <li>📏 <b>게이지</b> — 글자 수·바이트를 실시간으로 보여주고, 한도를 넘으면 빨갛게 알려줘요.</li>
      <li>⚡ <b>공통문구</b> — 편집줄 왼쪽 버튼들. 미리 등록한 반복 구절(정시·세특 도입부 등)을 <b>한 번에 삽입</b>(단축키 <b>Ctrl+1·2·3…</b>). 등록은 <b>설정 ▸ 공통문구</b>에서 그룹별·전체 공용으로.</li>
      <li>🔁 <b>표현 빈도</b> — 반복 단어·상투어를 세고, 누르면 본문에 노란 형광 표시 + <b>문장별 보기</b>로 바로 전환.</li>
      <li>✂️ <b>문장별 보기</b> — 문장 단위로 끊어 보고 너무 긴 문장을 표시.</li>
      <li>🧹 <b>줄바꿈·공백 정리</b> — PDF에서 긁어온 본문의 중간 줄바꿈과 이중 공백을 한 번에 정리.</li>
      <li>🏷️ <b>상태</b> — 왼쪽 사이드바 색 칩을 클릭하면 미작성→초안→검증→완료가 바뀌고 <b>바로 저장</b>됩니다.</li>
    </ul>` },
  { t: '4단계 · 맞춤법과 이력', h: `
    <ul>
      <li>🔍 <b>맞춤법</b> — 부산대 검사기로 점검. 결과 줄을 누르면 본문에서 강조되고, <b>반영</b>은 제안대로 고치고 <b>미반영</b>은 무시 목록에 넣어 다음부터 빼줍니다.</li>
      <li>␣ <b>이중 공백</b> — 맞춤법 점검 시 연속 공백도 같이 잡아 <b>한 번에 한 칸으로</b> 정리해요(검사기 연결이 안 돼도 작동).</li>
      <li>🕘 <b>이력 보기</b> — 저장 기록을 단어 단위로 비교하고 이전 버전으로 되돌릴 수 있어요(원본은 지워지지 않습니다).</li>
      <li>📋 <b>복사</b> — 본문을 복사해 NEIS 입력란에 <b>Ctrl+V</b>로 붙여넣기.</li>
    </ul>
    <p class="help-note">단축키 — 저장 <b>Ctrl+S</b> · 다음 미작성 <b>Ctrl+→</b> · 공통문구 <b>Ctrl+1~9</b></p>` },
  { t: '5단계 · 대시보드 · 복사 · 백업', h: `
    <ul>
      <li>📊 <b>대시보드</b> — 반 전체·세특 분반별 진행률을 한눈에 봅니다.</li>
      <li>📤 <b>엑셀 내보내기 → 업로드(일괄 입력)</b> — <b>[엑셀 내보내기]</b>를 누르면 단위 선택 창이 떠요. 켠 단위마다 <b>시트가 하나씩</b> 만들어집니다(자율/진로/행특, 세특은 분반별). 이 엑셀이 곧 <b>템플릿</b> — 본문 칸을 채워 <b>[📥 엑셀 업로드]</b>하면 학번·시트이름으로 찾아 <b>한 번에 저장</b>됩니다. (⚠ 시트 이름은 바꾸지 마세요. 빈 칸·안 바뀐 칸은 건너뜁니다.)</li>
      <li>📋 <b>영역별 복사</b> — 대시보드 상단 <b>[자율][진로][행특]</b> 버튼을 누르면 그 영역만 학생별 한 줄씩 떠서, 복사 버튼으로 내려가며 NEIS에 붙여넣기.</li>
      <li>💾 <b>암호화 백업</b> — 설정 ▸ 데이터·백업에서 비밀번호로 내보내, 다른 PC에서 같은 비밀번호로 불러오면 그대로 이어집니다. (비밀번호를 잊으면 복원 불가)</li>
      <li>🗑️ <b>데이터 삭제</b> — 새 학년엔 ‘생기부 데이터 삭제하기’로 명단·그룹·기록을 한 번에 초기화. <b>되돌릴 수 없으니 먼저 백업</b>하세요(영역·바이트 설정은 유지).</li>
    </ul>` },
  { t: '6단계 · 업데이트 · 피드백 · 종료', h: `
    <ul>
      <li>🔄 <b>자동 업데이트</b> — 새 버전이 나오면 알아서 받아 둡니다. 배너의 <b>변경 내용</b>으로 무엇이 바뀌었는지 볼 수 있어요.</li>
      <li>💬 <b>피드백</b> — 설정 ▸ <b>피드백</b>에서 버그 신고·기능 제안을 보내면 개발자(신도경)에게 전달됩니다. (학생 개인정보는 적지 마세요.)</li>
      <li>⏻ <b>프로그램 종료</b> — 왼쪽 아래 버튼. 저장 안 된 변경이 있으면 한 번 더 물어봐요.</li>
    </ul>
    <p class="help-lead">처음 5분만 설정하면, 그다음부터는 ‘쓰고 → 점검하고 → 붙여넣기’가 훨씬 가벼워집니다. 🙂</p>
    <p class="help-tip">이 안내는 아래 <b>다시 보지 않기</b>로 끌 수 있고, 왼쪽 위 <b>?</b> 로 언제든 다시 열 수 있어요.</p>` },
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

function openHelp() { state.helpPage = 0; renderHelp(); const hh = $('#helpHide'); if (hh) { try { hh.checked = !!localStorage.getItem('saengbu_help_hidden'); } catch (_) {} } $('#helpModal').hidden = false; }
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

const REPO_URL = 'https://github.com/fbwiqb/saengbu-helper';

async function openExternal(url) {
  try {
    const r = await fetch('/api/open-external', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok;
  } catch (_) { return false; }
}

const FB_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSfvCo7-_lilsWis303e78qu13EXs8AWONU8fuZMhmdEzCDGvQ/formResponse';

function openFb(kind) {
  state.fbKind = kind;
  $('#fbModalTitle').textContent = kind === 'feat' ? '기능 제안' : '버그 신고';
  $('#fbSubject').value = '';
  $('#fbDesc').value = '';
  $('#fbSubject').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); submitFb(); } };
  $('#fbModal').hidden = false;
  setTimeout(() => $('#fbSubject').focus(), 0);
}
function closeFb() { $('#fbModal').hidden = true; }

async function submitFb() {
  const kind = state.fbKind === 'feat' ? 'feat' : 'bug';
  const subject = $('#fbSubject').value.trim();
  const desc = $('#fbDesc').value.trim();
  if (!subject) { showToast('제목을 입력하세요'); return; }
  const fd = new URLSearchParams();
  fd.append('entry.1273396153', kind === 'feat' ? '기능 제안' : '버그');
  fd.append('entry.744183066', subject);
  fd.append('entry.1624751901', desc || '(내용 없음)');
  fd.append('fvv', '1'); fd.append('pageHistory', '0'); fd.append('submissionTimestamp', '-1');
  $('#fbSend').disabled = true;
  try {
    await fetch(FB_FORM, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: fd.toString() });
    closeFb();
    $('#fbMsg').textContent = '✓ 전송했습니다. 감사합니다!';
  } catch (e) {
    $('#fbMsg').textContent = '전송 실패 — 인터넷 연결을 확인하세요';
  }
  $('#fbSend').disabled = false;
  setTimeout(() => { $('#fbMsg').textContent = ''; }, 4000);
}

function showUpd(msg, percent, ready) {
  $('#updBanner').hidden = false;
  $('#updMsg').textContent = msg;
  $('#updTrack').hidden = ready || percent == null;
  if (percent != null) $('#updFill').style.width = Math.min(100, percent) + '%';
  $('#updRestart').hidden = !ready;
  $('#updNotes').hidden = false;
}

function setUpdMsg(t) { const el = $('#updCheckMsg'); if (el) el.textContent = t; }

function checkUpdate() {
  if (!window.updater) { setUpdMsg('데스크톱 앱에서만 확인할 수 있어요'); return; }
  state.updChecking = true;
  setUpdMsg('업데이트 확인 중…');
  window.updater.check();
  setTimeout(() => { if (state.updChecking) { state.updChecking = false; if ($('#updCheckMsg').textContent === '업데이트 확인 중…') setUpdMsg('확인 시간 초과 — 잠시 후 다시 시도하세요'); } }, 20000);
}

function initUpdater() {
  $('#updCheckBtn').onclick = checkUpdate;
  if (!window.updater) return;
  $('#updRestart').onclick = () => window.updater.restart();
  $('#updClose').onclick = () => { $('#updBanner').hidden = true; };
  window.updater.onAvailable((d) => { state.updChecking = false; showUpd(`새 버전 ${d.version || ''} 발견 — 다운로드 준비 중…`, 0, false); setUpdMsg(`업데이트가 있습니다 (${d.version || ''}) — 받는 중…`); });
  window.updater.onProgress((d) => showUpd(`업데이트 다운로드 중… ${Math.round(d.percent || 0)}%`, d.percent || 0, false));
  window.updater.onDownloaded((d) => { state.updChecking = false; showUpd(`새 버전 ${d.version || ''} 준비 완료 — 재시작하면 적용됩니다`, 100, true); setUpdMsg(`새 버전 ${d.version || ''} 준비 완료 — 종료/재시작 시 적용`); });
  window.updater.onNone(() => { state.updChecking = false; setUpdMsg('최신 버전입니다 ✓'); });
  window.updater.onError(() => { state.updChecking = false; setUpdMsg('확인 실패 — 인터넷을 확인하세요'); });
}

function mdLite(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { html += `<h4>${inline(h[2])}</h4>`; continue; }
    if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  return html || '<p class="muted">(내용 없음)</p>';
}

async function openNotes() {
  const m = $('#notesModal'); const b = $('#notesBody');
  b.innerHTML = '<div class="empty">불러오는 중…</div>';
  m.hidden = false;
  try {
    const r = await fetch('/api/release-notes');
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '오류');
    if (!Array.isArray(d) || !d.length) { b.innerHTML = '<div class="empty">표시할 변경 내용이 없습니다</div>'; return; }
    b.innerHTML = d.map((rel) => {
      const date = rel.date ? rel.date.slice(0, 10) : '';
      return `<section class="notes-rel"><div class="notes-rel-head"><b>${esc(rel.version || rel.name || '')}</b><span class="notes-date">${esc(date)}</span></div><div class="notes-md">${mdLite(rel.body)}</div></section>`;
    }).join('');
  } catch (e) {
    b.innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>변경 내용을 불러오지 못했습니다 — 인터넷 연결을 확인하세요</span></div>';
  }
}

function closeNotes() { $('#notesModal').hidden = true; }

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

async function resetData() {
  const v = await askText('⚠️ 등록 명단·그룹·모든 생기부 기록이 삭제됩니다. 되돌릴 수 없습니다. 계속하려면 삭제 라고 입력하세요.', '');
  if (v == null) return;
  if (v.trim() !== '삭제') { showToast('취소됨 — 확인 문구가 일치하지 않습니다'); return; }
  try {
    const r = await fetch('/api/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: '삭제' }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || '삭제 실패'); return; }
    showToast('✓ 모든 생기부 데이터가 삭제되었습니다');
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    showToast('삭제 실패 — 연결을 확인하세요');
  }
}

async function saveRecord(silent) {
  if (!state.hakbun || !state.area) return false;
  const url = `/api/records/${encodeURIComponent(state.hakbun)}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`;
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
  if (e.key === 'Escape') {
    if (!$('#exportModal').hidden) { closeExport(); return; }
    if (!$('#notesModal').hidden) { closeNotes(); return; }
    if (!$('#histModal').hidden) { closeHistory(); return; }
    if (!$('#helpModal').hidden) { closeHelp(); return; }
    if (!$('#fbModal').hidden) { closeFb(); return; }
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (state.hakbun) saveRecord(); }
  else if (mod && e.key === 'ArrowRight') { if (document.activeElement === $('#body')) return; e.preventDefault(); if (state.hakbun) gotoNextUnwritten(); }
  else if (mod && /^[1-9]$/.test(e.key) && state.view === 'student' && state.hakbun && state.area && !$('#body').hidden) {
    const p = applicablePhrases()[Number(e.key) - 1];
    if (p) { e.preventDefault(); insertCommonPhrase(p.text); }
  }
}

async function renderDash() {
  const d = await j('/api/dashboard?group=' + encodeURIComponent(state.group || ''));
  let written = 0, target = 0;
  for (const r of d.rows) for (const c of r.cells) { written += (c.bytes || 0); target += (c.limit || 0); }
  const bytePct = target ? Math.round((written / target) * 1000) / 10 : 0;
  const nf = (n) => n.toLocaleString('ko-KR');
  $('#dashProg').innerHTML =
    `<div class="progbar"><div class="fill" style="width:${d.completion}%"></div></div>
     <div class="summary">완료율 <b>${d.completion}%</b> · 완료 <b>${d.summary['완료']}</b> · 검증 <b>${d.summary['검증']}</b> · 초안 <b>${d.summary['초안']}</b> · 미작성 <b>${d.summary['미작성']}</b></div>
     <div class="summary bytesum">✍ 작성 <b>${nf(written)} B</b> / 목표 <b>${nf(target)} B</b> <span class="bytepct">(${bytePct}%)</span></div>`;
  const filter = $('#dashFilter').value;
  let areaSel = state.dashArea || '';
  if (areaSel && !d.areas.includes(areaSel)) areaSel = '';
  state.dashArea = areaSel;
  dashBodies = {};
  for (const r of d.rows) for (const c of r.cells) {
    if ((c.body || '').trim().length > 0) dashBodies[`${r.hakbun}|${c.area}|${c.subject || ''}`] = c.body;
  }
  const fillCls = (c) => c.status === '미작성' && !c.bytes ? 'none' : (c.pct > 100 ? 'over' : c.pct >= 95 ? 'full' : c.pct < 70 ? 'low' : 'ok');

  const areaEl = $('#dashAreas');
  if (areaEl) {
    areaEl.innerHTML = '<span class="dash-area-lab">영역별 복사</span>'
      + ['', ...d.areas].map((a) => `<button class="dash-area-btn${areaSel === a ? ' sel' : ''}" data-area="${esc(a)}">${a === '' ? '전체(학생별)' : esc(a)}</button>`).join('');
    areaEl.querySelectorAll('.dash-area-btn').forEach((b) => { b.onclick = () => { state.dashArea = b.dataset.area; renderDash(); }; });
  }

  const copyCell = (r, c) => {
    const key = `${r.hakbun}|${c.area}|${c.subject || ''}`;
    const hasText = (c.body || '').trim().length > 0;
    const lim = c.limit || state.targets[c.area] || 0;
    return hasText
      ? `<button class="cell-copy" data-key="${esc(key)}" data-area="${esc(c.area)}" data-lim="${lim}" title="${esc(c.area)} 복사">복사</button>`
      : '<span class="row-copy-empty">–</span>';
  };
  const writeCell = (r, c) => `<button class="gowrite" data-h="${esc(r.hakbun)}" data-g="${esc(state.group)}" data-a="${esc(c.area)}">쓰러 가기 ▶</button>`;
  const barCell = (c) => `<td class="barcol"><div class="dbar"><div class="dfill" style="width:${Math.min(100, c.pct)}%"></div></div></td>`;
  const byteCell = (c) => `<td class="abytes">${c.bytes} / ${c.limit || state.targets[c.area] || 0} B</td>`;

  const head = '<tr><th>복사</th><th>학번</th><th>이름</th><th>영역</th><th>진행</th><th>바이트</th><th>쓰기</th></tr>';
  let rows;
  if (areaSel) {
    rows = d.rows.map((r) => {
      const c = r.cells.find((x) => x.area === areaSel);
      if (!c) return '';
      const dim = filter && c.status !== filter ? ' dim' : '';
      return `<tr class="arow-tr ${fillCls(c)}${dim} stu-first">`
        + `<td class="copycol">${copyCell(r, c)}</td>`
        + `<td class="hakbun">${esc(r.disp || dispH(r.hakbun))}</td><td class="sname">${esc(r.name)}</td>`
        + `<td class="alabel">${esc(c.area)}</td>`
        + barCell(c) + byteCell(c)
        + `<td class="writecol">${writeCell(r, c)}</td></tr>`;
    }).join('');
  } else {
    rows = d.rows.map((r) => {
      const n = r.cells.length;
      return r.cells.map((c, i) => {
        const dim = filter && c.status !== filter ? ' dim' : '';
        const who = i === 0
          ? `<td class="hakbun" rowspan="${n}">${esc(r.disp || dispH(r.hakbun))}</td><td class="sname" rowspan="${n}">${esc(r.name)}</td>`
          : '';
        return `<tr class="arow-tr ${fillCls(c)}${dim}${i === 0 ? ' stu-first' : ''}">`
          + `<td class="copycol">${copyCell(r, c)}</td>${who}`
          + `<td class="alabel">${esc(c.area)}</td>`
          + barCell(c) + byteCell(c)
          + `<td class="writecol">${writeCell(r, c)}</td></tr>`;
      }).join('');
    }).join('');
  }
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

async function fetchAllUnits() {
  const groups = await j('/api/groups');
  const multiDamim = groups.filter((g) => g.category === '담임').length > 1;
  const units = [];
  for (const g of groups) {
    const d = await j('/api/dashboard?group=' + encodeURIComponent(g.group_tag));
    if (!d.rows.length) continue;
    if (g.category === '담임') {
      for (const area of d.areas) {
        const u = {
          category: '담임',
          label: multiDamim ? `${g.group_tag} · ${area}` : area,
          sheetName: multiDamim ? `${area} ${g.group_tag}` : area,
          area, subject: '', rows: [],
        };
        for (const r of d.rows) {
          const c = r.cells.find((x) => x.area === area) || {};
          u.rows.push({ hakbun: r.hakbun, disp: r.disp, name: r.name, body: c.body || '', status: c.status || '미작성' });
        }
        units.push(u);
      }
    } else {
      const area = d.areas[0] || g.category;
      const u = { category: g.category, label: g.group_tag, sheetName: g.group_tag, area, subject: g.group_tag, rows: [] };
      for (const r of d.rows) {
        const c = r.cells.find((x) => x.area === area) || {};
        u.rows.push({ hakbun: r.hakbun, disp: r.disp, name: r.name, body: c.body || '', status: c.status || '미작성' });
      }
      units.push(u);
    }
  }
  const used = new Set();
  for (const u of units) u.sheet = xlSheetName(u.sheetName, used);
  return units;
}

function xlSheetName(name, used) {
  let s = String(name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || '시트';
  const base = s; let i = 2;
  while (used.has(s)) { const suf = ' ' + i; s = base.slice(0, 31 - suf.length) + suf; i++; }
  used.add(s);
  return s;
}

async function openExport() {
  const box = $('#exportUnits');
  box.innerHTML = '<div class="empty">불러오는 중…</div>';
  $('#exportModal').hidden = false;
  let units;
  try { units = await fetchAllUnits(); } catch (e) { box.innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>불러오기 실패</span></div>'; return; }
  state.exportUnits = units;
  if (!units.length) { box.innerHTML = '<div class="empty">내보낼 학생이 없습니다. 먼저 명단을 등록하세요.</div>'; $('#exportGo').disabled = true; return; }
  $('#exportGo').disabled = false;
  const cats = [];
  for (const u of units) { if (!cats.includes(u.category)) cats.push(u.category); }
  box.innerHTML = cats.map((cat) => {
    const chips = units.map((u, idx) => u.category === cat
      ? `<button class="export-chip on" type="button" data-idx="${idx}">${esc(u.label)}</button>` : '').join('');
    return `<div class="export-cat"><span class="export-cat-lab">${esc(cat)}</span><div class="export-chips">${chips}</div></div>`;
  }).join('');
  box.querySelectorAll('.export-chip').forEach((c) => { c.onclick = () => { c.classList.toggle('on'); updateExportCount(); }; });
  updateExportCount();
}

function updateExportCount() {
  const on = $('#exportUnits').querySelectorAll('.export-chip.on').length;
  $('#exportCount').textContent = `${on}개 시트`;
  $('#exportGo').disabled = on === 0;
}

function closeExport() { $('#exportModal').hidden = true; }

function runExport() {
  const picked = [...$('#exportUnits').querySelectorAll('.export-chip.on')].map((c) => state.exportUnits[Number(c.dataset.idx)]);
  if (!picked.length) { showToast('내보낼 단위를 하나 이상 고르세요'); return; }
  const wb = XLSX.utils.book_new();
  for (const u of picked) {
    const aoa = [['학번', '이름', '본문'], ...u.rows.map((r) => [r.disp || dispH(r.hakbun), r.name, r.body])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 11 }, { wch: 10 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, ws, u.sheet);
  }
  XLSX.writeFile(wb, '생기부_전체.xlsx');
  closeExport();
  showToast(`✓ ${picked.length}개 시트로 내보냈습니다`);
}

async function importDash(file) {
  showToast('업로드 파일 분석 중…');
  let units;
  try { units = await fetchAllUnits(); } catch (e) { showToast('현재 데이터를 불러오지 못했습니다'); return; }
  const bySheet = {};
  for (const u of units) {
    const idx = {};
    for (const r of u.rows) idx[String(r.disp || dispH(r.hakbun))] = { key: r.hakbun, body: r.body, status: r.status };
    bySheet[u.sheet] = { area: u.area, subject: u.subject, idx };
  }
  let wb;
  try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); } catch (e) { showToast('엑셀을 읽지 못했습니다'); return; }
  const jobs = [];
  const skip = { sheet: 0, hakbun: 0, empty: 0, same: 0 };
  for (const sn of wb.SheetNames) {
    const target = bySheet[sn];
    if (!target) { skip.sheet++; continue; }
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
    if (!aoa.length) continue;
    const head = aoa[0].map((h) => String(h || '').trim());
    const hCol = head.indexOf('학번');
    const bCol = head.indexOf('본문');
    if (hCol < 0 || bCol < 0) { skip.sheet++; continue; }
    for (let i = 1; i < aoa.length; i++) {
      const hak = String(aoa[i][hCol] == null ? '' : aoa[i][hCol]).trim();
      if (!hak) continue;
      const body = String(aoa[i][bCol] == null ? '' : aoa[i][bCol]);
      const cur = target.idx[hak];
      if (!cur) { skip.hakbun++; continue; }
      if (!body.trim()) { skip.empty++; continue; }
      if (body === cur.body) { skip.same++; continue; }
      const status = (!cur.status || cur.status === '미작성') ? '초안' : cur.status;
      jobs.push({ hakbun: cur.key, area: target.area, subject: target.subject, body, status });
    }
  }
  if (!jobs.length) {
    showToast(`저장할 변경이 없습니다 (그대로 ${skip.same} · 빈칸 ${skip.empty} · 없는학번 ${skip.hakbun})`);
    return;
  }
  const names = new Set(jobs.map((x) => x.hakbun));
  if (!confirm(`${names.size}명 · ${jobs.length}건을 저장합니다.\n(변경된 칸만 반영 — 빈칸/동일 내용은 건너뜀)\n계속할까요?`)) return;
  let ok = 0, fail = 0;
  for (const job of jobs) {
    try {
      const r = await fetch(`/api/records/${encodeURIComponent(job.hakbun)}/${encodeURIComponent(job.area)}?subject=${encodeURIComponent(job.subject)}`,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: job.body, status: job.status }) });
      if (r.ok) ok++; else fail++;
    } catch (e) { fail++; }
    if ((ok + fail) % 20 === 0) showToast(`저장 중… ${ok + fail}/${jobs.length}`);
  }
  await loadList();
  if (state.view === 'dash') await renderDash();
  showToast(`✓ ${ok}건 저장 완료${fail ? ` · 실패 ${fail}` : ''} · 건너뜀(그대로 ${skip.same}·빈칸 ${skip.empty}·없는학번 ${skip.hakbun})`);
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
  if (t === 'phrases') renderPhrases();
}

function phraseGroupOptions(sel) {
  const opts = ['<option value="">전체 공용</option>'];
  for (const g of (state.groupsList || [])) opts.push(`<option value="${esc(g.group_tag)}" ${g.group_tag === sel ? 'selected' : ''}>${esc(g.group_tag)}</option>`);
  return opts.join('');
}

function renderPhrases() {
  const list = state.phrases || [];
  const rows = list.map((p, i) => `<div class="phrase-row card" data-i="${i}">
      <div class="row">
        <select class="ph-group" data-i="${i}">${phraseGroupOptions(p.group_tag || '')}</select>
        <input class="ph-title" data-i="${i}" type="text" placeholder="제목 (목록에 표시될 이름)" value="${esc(p.title || '')}" />
        <span class="spacer"></span>
        <button class="ph-del btn-ghost danger" data-i="${i}" type="button">삭제</button>
      </div>
      <textarea class="ph-text" data-i="${i}" rows="3" placeholder="삽입할 문구 (예: ~~~한 수행평가에서 )">${esc(p.text || '')}</textarea>
    </div>`).join('');
  $('#phraseList').innerHTML = rows || '<div class="empty">등록된 공통문구가 없습니다. 아래 ‘+ 공통문구 추가’를 누르세요.</div>';
  $('#phraseList').querySelectorAll('.ph-del').forEach((b) => { b.onclick = () => { collectPhrases(); state.phrases.splice(Number(b.dataset.i), 1); renderPhrases(); }; });
}

function collectPhrases() {
  const prev = state.phrases || [];
  state.phrases = [...document.querySelectorAll('#phraseList .phrase-row')].map((r) => ({
    id: (prev[Number(r.dataset.i)] || {}).id || ('cp' + Date.now() + Math.floor(Math.random() * 1000)),
    group_tag: r.querySelector('.ph-group').value,
    title: r.querySelector('.ph-title').value,
    text: r.querySelector('.ph-text').value,
  }));
}

function phraseAdd() {
  collectPhrases();
  state.phrases.push({ id: 'cp' + Date.now(), group_tag: (state.view === 'student' ? state.group : '') || '', title: '', text: '' });
  renderPhrases();
}

async function phraseSave() {
  collectPhrases();
  const payload = (state.phrases || []).filter((p) => (p.text || '').trim());
  try {
    const r = await fetch('/api/common-phrases', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phrases: payload }) });
    const d = await r.json();
    if (!r.ok) { $('#phraseMsg').textContent = d.error || '저장 실패'; return; }
    state.phrases = d;
    renderPhrases();
    $('#phraseMsg').textContent = `✓ 저장됨 (${d.length}개)`;
    setTimeout(() => { $('#phraseMsg').textContent = ''; }, 3000);
  } catch (e) { $('#phraseMsg').textContent = '저장 실패'; }
}

function applicablePhrases() {
  const g = state.group || '';
  return (state.phrases || []).filter((p) => (p.text || '').trim() && (!p.group_tag || p.group_tag === g));
}

function renderPhraseButtons() {
  const el = $('#phraseBtns');
  if (!el) return;
  const list = applicablePhrases();
  el.innerHTML = list.map((p, i) => {
    const kbd = i < 9 ? `<span class="kbd">Ctrl+${i + 1}</span>` : '';
    return `<button class="ph-quick btn-ghost" type="button" data-id="${esc(p.id)}" title="${esc(p.text)}"><span class="ph-q-t">${esc(p.title || p.text.slice(0, 16))}</span>${kbd}</button>`;
  }).join('');
  el.querySelectorAll('.ph-quick').forEach((b) => { b.onclick = () => { const p = list.find((x) => x.id === b.dataset.id); if (p) insertCommonPhrase(p.text); }; });
}

function insertCommonPhrase(text) {
  if (state.sentMode || state.hlMode) showEdit();
  const ta = $('#body');
  const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  const e = ta.selectionEnd != null ? ta.selectionEnd : s;
  const v = ta.value;
  const head = v.slice(0, s) + text;
  ta.value = (head + v.slice(e)).replace(/ {2,}/g, ' ');
  const pos = head.replace(/ {2,}/g, ' ').length;
  ta.focus();
  try { ta.setSelectionRange(pos, pos); } catch (_) {}
  ta.dispatchEvent(new Event('input'));
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
  $('#managePanel').querySelectorAll('.mg-byte').forEach((sel) => {
    sel.onchange = () => {
      const inp = sel.parentNode.querySelector('.mg-byte-custom');
      if (sel.value === 'custom') { if (inp) { inp.hidden = false; inp.focus(); } return; }
      if (inp) inp.hidden = true;
      setGroupByteUI(sel.dataset.g, sel.value);
    };
  });
  $('#managePanel').querySelectorAll('.mg-byte-custom').forEach((inp) => {
    inp.onchange = () => { if (inp.value && Number(inp.value) > 0) setGroupByteUI(inp.dataset.g, inp.value); };
  });
  $('#managePanel').querySelectorAll('.mg-caret').forEach((b) => { b.onclick = () => toggleMg(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-rename').forEach((b) => { b.onclick = () => renameGroupUI(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-del').forEach((b) => { b.onclick = () => deleteGroupUI(b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-remove').forEach((b) => { b.onclick = () => removeMemberUI(b.dataset.h, b.dataset.g); });
  $('#managePanel').querySelectorAll('.mg-srename').forEach((b) => { b.onclick = () => renameStudentMg(b.dataset.h, b.dataset.g, b.dataset.n); });
  $('#managePanel').querySelectorAll('.mg-add').forEach((b) => { b.onclick = () => addStudentMg(b.dataset.g); });
}

function groupByteControl(g) {
  if (!PER_SUBJECT.has(g.category)) return '';
  const cur = Number(g.byte_limit) || '';
  const custom = cur !== '' && !BYTE_PRESETS.includes(cur);
  const presets = BYTE_PRESETS.map((p) => `<option value="${p}" ${cur === p ? 'selected' : ''}>${p}B</option>`).join('');
  return `<select class="mg-byte" data-g="${esc(g.group_tag)}" title="이 그룹만 다른 바이트 한도 (예: 1학년 세특 750)">
      <option value="" ${!cur ? 'selected' : ''}>설정값</option>${presets}<option value="custom" ${custom ? 'selected' : ''}>직접입력</option>
    </select><input class="mg-byte-custom" data-g="${esc(g.group_tag)}" type="number" min="1" placeholder="바이트" value="${esc(custom ? cur : '')}" ${custom ? '' : 'hidden'} />`;
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
  const rows = list.length
    ? list.map((s) => `<div class="mg-stu"><span class="mg-stu-name">${esc(s.disp || dispH(s.hakbun))} ${esc(s.name)}</span><span class="mg-stu-btns"><button class="mg-srename btn-ghost" data-h="${esc(s.hakbun)}" data-g="${esc(tag)}" data-n="${esc(s.name || '')}">이름변경</button><button class="mg-remove btn-ghost" data-h="${esc(s.hakbun)}" data-g="${esc(tag)}">빼기</button></span></div>`).join('')
    : '<div class="muted">학생 없음</div>';
  return rows + `<div class="mg-addstu"><button class="mg-add btn-ghost" data-g="${esc(tag)}">+ 학생 추가</button></div>`;
}

async function addStudentMg(tag) {
  const hakbun = ((await askText('추가할 학생의 학번 — ' + tag, '')) || '').trim(); if (!hakbun) return;
  const name = ((await askText('학생 이름', '')) || '').trim();
  await j('/api/students', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hakbun, name, group_tag: tag }) });
  delete state.studsByGroup[tag]; await loadGroup(tag);
  await refreshGroups(); renderManage(); await loadList();
  showToast('✓ 학생 추가됨');
}

async function renameStudentMg(hakbun, tag, cur) {
  const nn = ((await askText('학생 이름 변경 (' + dispH(hakbun) + ')', cur)) || '').trim();
  if (!nn || nn === cur) return;
  await j('/api/students/' + encodeURIComponent(hakbun), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: nn }) });
  delete state.studsByGroup[tag]; await loadGroup(tag);
  renderManage(); await loadList();
  showToast('✓ 이름 변경됨');
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
  if (!confirm(`${dispH(hakbun)} 학생을 '${tag}'에서 뺄까요?\n작성한 기록은 보존됩니다. (다른 그룹에도 없고 작성 내용이 전혀 없을 때만 학생이 정리됩니다)`)) return;
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

function splitName(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = s.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return (m && m[1].trim()) ? { name: m[1].trim(), paren: m[2].trim() } : { name: s, paren: '' };
}

function buildCombined(sheets) {
  const groups = {};
  let noHakbun = 0; let noGroup = 0;
  const namesByHak = {};
  for (const { category, rows } of sheets) {
    const fallback = category === '담임' ? '우리반' : '';
    for (const r of rows) {
      const hakbun = String(r['학번'] != null ? r['학번'] : (r.hakbun || '')).trim();
      if (!hakbun) { noHakbun += 1; continue; }
      const grp = rowGroup(category, r, fallback);
      if (!grp) { noGroup += 1; continue; }
      const { name, paren } = splitName(r['이름'] != null ? r['이름'] : r.name);
      const naesin = /^\d+(\.\d+)?$/.test(paren) ? Number(paren) : null;
      const key = `${category}|${grp}`;
      if (!groups[key]) groups[key] = { category, group: grp, students: [] };
      groups[key].students.push({ hakbun, name, naesin });
      if (name) (namesByHak[hakbun] = namesByHak[hakbun] || new Set()).add(name);
    }
  }
  const conflicts = Object.entries(namesByHak)
    .filter(([, set]) => set.size > 1)
    .map(([hakbun, set]) => ({ hakbun, names: [...set] }));
  return { groups, noHakbun, noGroup, conflicts };
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

function showCombinedPreview({ groups, noHakbun, noGroup, conflicts }) {
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
  if (conflicts && conflicts.length) {
    const ex = conflicts.slice(0, 3).map((c) => `학번 ${esc(c.hakbun)} = ${c.names.map(esc).join(' / ')}`).join(' · ');
    $('#upMsg').innerHTML = `<span style="color:var(--red);font-weight:700">⚠ 학번이 겹치는데 이름이 다릅니다(${conflicts.length}건): ${ex}${conflicts.length > 3 ? ' 외' : ''}. 학번은 학생마다 유일해야 하며, 겹치면 서로 덮어써 이름이 뒤섞입니다. 반별 번호가 아닌 <b>전체 학번(예: 30401)</b>을 쓰세요.</span>`;
  } else {
    $('#upMsg').textContent = '';
  }
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
