const fs = require('fs');

function loadForbidden(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function scan(text, terms) {
  const hits = [];
  const s = String(text || '');
  for (const term of terms) {
    if (!term) continue;
    let i = s.indexOf(term);
    while (i !== -1) {
      hits.push({ term, index: i });
      i = s.indexOf(term, i + term.length);
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

module.exports = { loadForbidden, scan };
