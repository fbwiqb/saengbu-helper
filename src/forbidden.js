const fs = require('fs');

const CAT_REASON = {
  '대회·수상': '교외 대회·수상·자격증·논문 등 기재 금지',
  '어학·성적': '어학시험·모의고사 성적 기재 금지',
  '해외활동': '해외 활동(어학연수·봉사) 기재 금지',
  '지식재산': '출간·특허 등 지식재산권 기재 금지',
  '장학': '장학금·장학생 기재 금지',
  '학교유추': '학교를 알 수 있는 표현',
  '상호명': '특정 상호·브랜드명 — 대체어 권장',
  '기관': '특정 기관·기구명 — "국제 기구"로 대체',
  '순위': '수상 등위(순위) 표기 지양',
  '기타': '기재 금지 표현',
};

function normalize(raw) {
  if (Array.isArray(raw)) return { terms: raw.map((t) => ({ term: t, cat: '기타' })), patterns: [], whitelist: [] };
  return { terms: raw.terms || [], patterns: raw.patterns || [], whitelist: raw.whitelist || [] };
}

function loadRules(file) {
  return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scan(text, rules) {
  const s = String(text || '');
  const R = rules && rules.terms ? rules : normalize(rules);
  const white = new Set((R.whitelist || []).map(String));
  const hits = [];
  for (const t of R.terms || []) {
    const term = typeof t === 'string' ? t : t.term;
    if (!term) continue;
    const cat = (t && t.cat) || '기타';
    const reason = (t && t.reason) || CAT_REASON[cat] || CAT_REASON['기타'];
    const replace = (t && t.replace) || '';
    if (t && t.boundary) {
      const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'g');
      let m;
      while ((m = re.exec(s)) !== null) {
        if (!white.has(m[0])) hits.push({ term: m[0], cat, reason, replace, index: m.index });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    } else {
      let i = s.indexOf(term);
      while (i !== -1) {
        if (!white.has(term)) hits.push({ term, cat, reason, replace, index: i });
        i = s.indexOf(term, i + term.length);
      }
    }
  }
  for (const p of R.patterns || []) {
    let re;
    try { re = new RegExp(p.re, 'g'); } catch (e) { continue; }
    let m;
    while ((m = re.exec(s)) !== null) {
      if (m[0]) hits.push({ term: m[0], cat: p.cat || '순위', reason: p.reason || CAT_REASON[p.cat] || CAT_REASON['기타'], replace: '', index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  hits.sort((a, b) => a.index - b.index || b.term.length - a.term.length);
  const kept = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.index < lastEnd) continue;
    kept.push(h);
    lastEnd = h.index + h.term.length;
  }
  return kept;
}

module.exports = { loadRules, loadForbidden: loadRules, scan };
