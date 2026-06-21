function extractBooks(text) {
  const re = /['‘]([^'’()]+?)\(([^)]+)\)['’]/g;
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push({ title: m[1].trim(), author: m[2].trim() });
  }
  return out;
}

module.exports = { extractBooks };
