const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { group: null, hakbun: null, area: null, subject: '', targets: {}, forbidden: [], student: null, view: 'student', listCache: [], config: { categories: [], areas: {} }, groupCat: {}, sentMode: false, dirty: false, groupsList: [], expanded: new Set(), studsByGroup: {}, sortUnwritten: false, hlMode: false };
let dashBodies = {};

const AREA_LABEL = {
  자율: '자율·자치활동', 진로: '진로활동', 동아리: '동아리활동',
  행특: '행동특성및종합의견', 세특: '세부능력및특기사항',
};
const CATEGORY_AREAS = {
  담임: ['자율', '진로', '행특'],
  세특: ['세특'],
  동아리: ['동아리'],
  기타: [],
};
const BYTE_PRESETS = [1500, 900, 750];
const PER_SUBJECT = new Set(['세특', '동아리', '기타']);
const CONNECTIVES = ['이를 통해', '이러한', '또한', '뿐만 아니라', '나아가', '한편', '그리하여', '따라서', '그러므로', '이로써', '이에', '특히', '아울러', '더불어', '바탕으로', '계기로', '통하여', '결과적으로', '뿐만'];
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

async function copyText(raw, area, label) {
  const text = String(raw || '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  if (!text) { showToast('복사할 내용이 없습니다'); return; }
  try {
    await navigator.clipboard.writeText(text);
    const limit = state.targets[area] || 0;
    const b = calcBytes(text);
    const over = limit && b > limit ? ' ⚠ 한도초과' : '';
    showToast(`✓ ${label ? label + ' ' : ''}복사됨 · ${b}${limit ? '/' + limit : ''} byte${over} · NEIS에 붙여넣기`);
  } catch (e) {
    showToast('복사 실패 — 브라우저 권한 확인');
  }
}

function copyArea() { return copyText($('#body').value, state.area); }

async function boot() {
  state.config = await j('/api/config');
  state.forbidden = await j('/api/forbidden');
  buildTargets();
  await refreshGroups();
  $('#body').addEventListener('input', () => { state.dirty = true; renderAssist(); });
  $('#saveBtn').onclick = () => saveRecord();
  $('#copyBtn').onclick = copyArea;
  $('#spellBtn').onclick = runSpell;
  $('#histBtn').onclick = openHistory;
  $('#histClose').onclick = closeHistory;
  $('#histModal').onclick = (e) => { if (e.target === $('#histModal')) closeHistory(); };
  $('#nextBtn').onclick = gotoNextUnwritten;
  $('#sentToggle').onclick = toggleSentMode;
  $('#vStudent').onclick = () => setView('student');
  $('#vDash').onclick = () => setView('dash');
  $('#vSettings').onclick = () => setView('settings');
  $('#dashFilter').onchange = renderDash;
  $('#cfgSave').onclick = saveConfig;
  $('#upBtn').onclick = handleUpload;
  $('#tmplLink').onclick = downloadTemplate;
  $('#stuSearch').oninput = onSearch;
  $('#sortToggle').onclick = () => { state.sortUnwritten = !state.sortUnwritten; $('#sortToggle').textContent = state.sortUnwritten ? '미작성순' : '학번순'; renderTree(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
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

function progBadge(s) {
  const p = s.prog;
  if (!p || !p.total) return `<span class="badge">${esc(s.status || '미작성')}</span>`;
  const ip = Math.max(0, p.started - p.done);
  const cls = p.done >= p.total ? '완료' : (p.started ? '초안' : '');
  return `<span class="badge ${cls}" title="저장 ${p.done} · 작성중 ${ip} · 전체 ${p.total}">${p.done}/${ip}/${p.total}</span>`;
}

function renderStuds(tag, q) {
  let list = state.studsByGroup[tag];
  if (!list) return state.expanded.has(tag) ? '<li class="loading">불러오는 중…</li>' : '';
  list = sortStuds(list.filter((s) => !q || (`${s.hakbun} ${s.name}`).toLowerCase().includes(q)));
  if (!list.length) return q ? '<li class="empty">결과 없음</li>' : '<li class="empty">학생 없음</li>';
  return list.map((s) =>
    `<li data-h="${esc(s.hakbun)}" data-g="${esc(tag)}" class="${s.hakbun === state.hakbun && tag === state.group ? 'sel' : ''}">
       <span class="nm">${esc(s.hakbun)} ${esc(s.name)}</span>
       ${progBadge(s)}</li>`).join('');
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
  const hasGroups = state.groupsList.length > 0;
  if (!hasGroups) {
    $('#emptyTitle').textContent = '시작하려면 설정에서 명단을 올리세요';
    $('#emptyMsg').innerHTML = '아직 등록된 그룹이 없습니다. <b>설정 탭</b>에서 분류별 영역을 정하고 학생 명단(xlsx/csv)을 업로드하세요.';
  } else {
    $('#emptyTitle').textContent = '학생을 선택하세요';
    $('#emptyMsg').innerHTML = '왼쪽에서 <b>그룹을 펼쳐</b> 학생을 고르세요. 검색·정렬로 빠르게 찾을 수 있습니다.';
  }
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
  const hakbun = prompt('학번?'); if (!hakbun) return;
  const name = prompt('이름?') || '';
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
  if (state.view !== 'student') { setView('student'); } else { setView('student'); }
  const g = state.group || '';
  const s = state.student;
  $('#headInfo').innerHTML = `${esc(s.hakbun)} ${esc(s.name)}<span class="sub">(${esc(catFor(g))}) ${esc(g)}${(s.groups || []).length > 1 ? ' · 소속 ' + esc((s.groups || []).join(', ')) : ''}</span>`;
  const areas = areasFor(g);
  $('#tabs').innerHTML = areas.map((a) => `<button data-a="${esc(a)}">${esc(a)}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => { b.onclick = async () => { await saveIfDirty(); selectArea(b.dataset.a); }; });
  loadList();
  selectArea(areas[0]);
}

function selectArea(area) {
  state.area = area;
  state.subject = PER_SUBJECT.has(catFor(state.group)) ? (state.group || '') : '';
  $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.a === area));
  const rec = (state.student.records || []).find((r) => r.area === area && r.subject === state.subject) || {};
  $('#body').value = rec.body || '';
  $('#status').value = rec.status || '미작성';
  showEdit();
  renderAssist();
  $('#spellPanel').innerHTML = '<div class="empty">‘맞춤법’ 버튼을 눌러 점검</div>';
  state.dirty = false;
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
  const limit = state.targets[state.area] || 0;
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

  renderFreq(text);
  if (state.sentMode) renderSentences(text);
}

function splitSentences(text) {
  const t = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?\n]*(?:[.!?]+|\n|$)/g) || [];
  return parts.map((s) => s.trim()).filter(Boolean);
}

function renderSentences(text) {
  const sents = splitSentences(text);
  if (!sents.length) { $('#sentView').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  $('#sentView').innerHTML = sents.map((s, i) => {
    const n = [...s].length;
    const long = n > 120;
    const veryLong = n > 160;
    const cls = veryLong ? 'sent vlong' : long ? 'sent long' : 'sent';
    return `<div class="${cls}"><span class="sno">${i + 1}</span><span class="stx">${esc(s)}</span><span class="slen">${n}자 · ${calcBytes(s)}B</span></div>`;
  }).join('');
}

function showEdit() {
  state.sentMode = false; state.hlMode = false;
  $('#body').hidden = false; $('#sentView').hidden = true;
  $('#sentToggle').classList.remove('sel'); $('#sentToggle').textContent = '문장별 보기';
}

function toggleSentMode() {
  if (state.sentMode || state.hlMode) { showEdit(); return; }
  state.sentMode = true;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
  $('#body').hidden = true; $('#sentView').hidden = false;
  renderSentences($('#body').value);
}

function highlightTerm(term) {
  if (!term) return;
  state.hlMode = true; state.sentMode = false;
  const text = $('#body').value;
  const html = esc(text).split(esc(term)).join(`<mark class="hl">${esc(term)}</mark>`).replace(/\n/g, '<br>');
  const count = text.split(term).length - 1;
  $('#sentView').innerHTML = `<div class="hl-head">‘<b>${esc(term)}</b>’ ${count}회 강조 — 편집하려면 ‘편집으로’</div><div class="hlview">${html}</div>`;
  $('#body').hidden = true; $('#sentView').hidden = false;
  $('#sentToggle').classList.add('sel'); $('#sentToggle').textContent = '편집으로';
}

function renderFreq(text) {
  const t = String(text || '');
  const conn = CONNECTIVES
    .map((c) => ({ c, n: (t.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length }))
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

async function runSpell() {
  const text = $('#body').value.trim();
  if (!text) { $('#spellPanel').innerHTML = '<div class="empty">본문이 비어 있음</div>'; return; }
  $('#spellPanel').innerHTML = '<div class="empty">부산대 검사기로 검사 중…</div>';
  try {
    const r = await fetch('/api/spellcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const d = await r.json();
    if (!r.ok) { $('#spellPanel').innerHTML = `<div class="warn-item err"><span class="ico">⚠</span><span>검사 실패 — ${esc(d.error || '연결 오류')}</span></div>`; return; }
    if (!d.errors.length) { $('#spellPanel').innerHTML = '<div class="warn-item ok"><span class="ico">●</span><span>맞춤법 의심 없음</span></div>'; return; }
    $('#spellPanel').innerHTML = `<div class="muted" style="margin-bottom:6px">${d.errors.length}건</div>`
      + d.errors.map((e) => `<div class="spell-item"><div class="sp-top"><span class="sp-orig">${esc(e.orig)}</span><span class="sp-arrow">→</span><span class="sp-sug">${esc(e.suggest.join(', ') || '-')}</span></div>${e.help ? `<div class="sp-help">${esc(e.help)}</div>` : ''}</div>`).join('');
    showToast(`맞춤법 의심 ${d.errors.length}건`);
  } catch (e) {
    $('#spellPanel').innerHTML = '<div class="warn-item err"><span class="ico">⚠</span><span>검사기 연결 실패 — 인터넷 확인</span></div>';
  }
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

async function saveRecord(silent) {
  if (!state.hakbun || !state.area) return;
  const url = `/api/records/${state.hakbun}/${encodeURIComponent(state.area)}?subject=${encodeURIComponent(state.subject)}`;
  state.student = await j(url, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: $('#body').value, status: $('#status').value }) });
  state.dirty = false;
  await loadList();
  if (!silent) showToast('✓ 저장됨');
}

async function saveIfDirty() {
  if (state.dirty && state.hakbun && state.area) await saveRecord(true);
  state.dirty = false;
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
      const lim = state.targets[c.area] || 0;
      const dim = filter && c.status !== filter ? ' dim' : '';
      const copyBtn = hasText
        ? `<button class="cell-copy" data-key="${esc(key)}" data-area="${esc(c.area)}" title="${esc(c.area)} 복사">복사</button>`
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
    b.onclick = () => copyText(dashBodies[b.dataset.key], b.dataset.area);
  });
  $('#dashTable').querySelectorAll('.gowrite').forEach((b) => {
    b.onclick = () => openWrite(b.dataset.h, b.dataset.g, b.dataset.a);
  });
}

async function openWrite(hakbun, group, area) {
  await openStudent(hakbun, group);
  if (area) selectArea(area);
}


function byteSelect(area, limit) {
  const isPreset = BYTE_PRESETS.includes(limit);
  const opts = BYTE_PRESETS.map((p) => `<option value="${p}" ${limit === p ? 'selected' : ''}>${p}</option>`).join('')
    + `<option value="custom" ${!isPreset ? 'selected' : ''}>직접입력</option>`;
  return `<select class="cfg-byte" data-area="${esc(area)}">${opts}</select>`
    + `<input class="cfg-custom" data-area="${esc(area)}" type="number" min="1" value="${esc(limit)}" ${isPreset ? 'hidden' : ''} />`;
}

function renderSettings() {
  const cats = state.config.categories || [];
  $('#cfgCards').innerHTML = cats.map((cat) => {
    const list = state.config.areas[cat] || [];
    const byKey = {};
    for (const a of list) byKey[a.area] = a.limit;
    if (cat === '기타') {
      const custom = list.map((a) => customRow(cat, a.area, a.limit)).join('');
      return `<div class="cfg-card" data-cat="${esc(cat)}">
        <h3>${esc(cat)}</h3><div class="cfg-custom-list">${custom}</div>
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
    return `<div class="cfg-card" data-cat="${esc(cat)}"><h3>${esc(cat)}</h3>${rows}</div>`;
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

  const upSel = $('#upCategory');
  if (!upSel.options.length) upSel.innerHTML = cats.map((c) => `<option>${esc(c)}</option>`).join('');
  upSel.onchange = updateUploadHint;
  updateUploadHint();
}

function updateUploadHint() {
  const cat = $('#upCategory').value;
  const hints = {
    담임: '담임 시트: 학번·이름. 아래 그룹명(반)으로 등록됩니다.',
    세특: '세특 시트: 과목명·분반·학번·이름. 과목명+분반이 그룹이 됩니다(그룹명 입력 불필요).',
    동아리: '동아리 시트: 동아리명·학번·이름. 동아리명이 그룹이 됩니다.',
    기타: '기타 시트: 구분·학번·이름. 구분값이 그룹이 됩니다.',
  };
  $('#upHint').textContent = hints[cat] || '';
  $('#upGroupLabel').hidden = cat !== '담임';
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

function parseFile(file, sheetName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const pick = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
        resolve(XLSX.utils.sheet_to_json(wb.Sheets[pick], { defval: '' }));
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
  if (cat === '세특') { const s = g('과목명'); const b = g('분반'); return s ? (b ? `${s} ${b}` : s) : ''; }
  if (cat === '동아리') return g('동아리명');
  if (cat === '기타') return g('구분');
  return fallback;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  for (const cat of (state.config.categories || ['담임', '세특', '동아리', '기타'])) {
    const ws = XLSX.utils.aoa_to_sheet([TMPL_COLS[cat], ...TMPL_EX[cat]]);
    ws['!cols'] = TMPL_COLS[cat].map(() => ({ wch: 13 }));
    XLSX.utils.book_append_sheet(wb, ws, cat);
  }
  XLSX.writeFile(wb, '생기부-학생명단-템플릿.xlsx');
}

async function handleUpload() {
  const file = $('#upFile').files[0];
  const fallback = ($('#upGroup').value || '').trim();
  const category = $('#upCategory').value;
  if (!file) { $('#upMsg').textContent = '파일을 선택하세요'; return; }
  if (category === '담임' && !fallback) { $('#upMsg').textContent = '담임은 그룹명(반)을 입력하세요'; return; }
  $('#upMsg').textContent = '처리 중…';
  let rows;
  try { rows = await parseFile(file, category); } catch (e) { $('#upMsg').textContent = '파싱 실패: ' + e.message; return; }
  const groups = {};
  for (const r of rows) {
    const hakbun = String(r['학번'] != null ? r['학번'] : (r.hakbun || '')).trim();
    if (!hakbun) continue;
    const grp = rowGroup(category, r, fallback);
    if (!grp) continue;
    (groups[grp] = groups[grp] || []).push({ hakbun, name: String(r['이름'] || r.name || '').trim() });
  }
  const names = Object.keys(groups);
  if (!names.length) { $('#upMsg').textContent = '등록할 행이 없습니다 — 학번·그룹 열을 확인하세요'; return; }
  $('#upPreview').innerHTML = names.map((g) => `<div class="muted">· <b>${esc(g)}</b> ${groups[g].length}명</div>`).join('');
  let total = 0;
  for (const g of names) {
    const res = await j('/api/students/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group_tag: g, category, students: groups[g] }) });
    total += res.added;
  }
  $('#upMsg').textContent = `✓ ${total}명 · ${names.length}개 그룹 등록됨`;
  await refreshGroups();
  loadList();
}

boot();
