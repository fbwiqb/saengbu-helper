const TARGETS = { 자율: 1500, 진로: 1500, 행특: 900, 세특: 1500, 동아리: 1500 };

function calcBytes(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  let total = 0;
  for (const ch of s) {
    if (ch === '\n') total += 2;
    else {
      const cp = ch.codePointAt(0);
      if (cp <= 0x7f) total += 1;
      else if (cp <= 0x7ff) total += 2;
      else if (cp <= 0xffff) total += 3;
      else total += 4;
    }
  }
  return total;
}

function evaluate(text, area) {
  const bytes = calcBytes(text);
  const limit = TARGETS[area] || 0;
  const pct = limit ? Math.round((bytes / limit) * 1000) / 10 : 0;
  let status = 'unknown';
  if (limit) {
    if (bytes > limit) status = 'over';
    else if (pct >= 95) status = 'full';
    else if (pct < 70) status = 'low';
    else status = 'ok';
  }
  return { bytes, limit, pct, status };
}

module.exports = { TARGETS, calcBytes, evaluate };
