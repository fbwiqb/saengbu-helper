const https = require('https');
const http = require('http');

const ENDPOINTS = [
  'https://nara-speller.co.kr/old_speller/results',
  'https://speller.cs.pusan.ac.kr/results',
];
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
};

let electronNet = null;
try { electronNet = require('electron').net; } catch (_e) { electronNet = null; }

function viaElectron(url, postData) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = electronNet.request({ method: 'POST', url });
    req.setHeader('Origin', u.origin);
    req.setHeader('Referer', u.origin + '/');
    for (const [k, v] of Object.entries(HEADERS)) req.setHeader(k, v);
    req.on('response', (resp) => {
      if (resp.statusCode >= 400) { reject(new Error('HTTP ' + resp.statusCode)); return; }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function viaNode(url, postData) {
  const u = new URL(url);
  const mod = u.protocol === 'http:' ? http : https;
  const opts = {
    method: 'POST', hostname: u.hostname, path: u.pathname,
    headers: { ...HEADERS, Origin: u.origin, Referer: u.origin + '/', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 20000,
  };
  if (u.protocol === 'https:') opts.rejectUnauthorized = false;
  return new Promise((resolve, reject) => {
    const req = mod.request(opts, (resp) => {
      if (resp.statusCode >= 400) { resp.resume(); reject(new Error('HTTP ' + resp.statusCode)); return; }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(postData);
    req.end();
  });
}

async function fetchResults(text) {
  const postData = 'text1=' + encodeURIComponent(text);
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      return electronNet ? await viaElectron(url, postData) : await viaNode(url, postData);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('모든 검사기 연결 실패');
}

function stripTags(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parse(html) {
  const m = html.match(/data\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const errors = [];
  for (const block of (Array.isArray(data) ? data : [])) {
    for (const e of (block.errInfo || [])) {
      errors.push({
        orig: e.orgStr || '',
        suggest: String(e.candWord || '').split('|').map((s) => s.trim()).filter(Boolean),
        help: stripTags(e.help),
      });
    }
  }
  return errors;
}

function chunk(text, size) {
  const t = String(text || '');
  const out = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const seg = t.slice(i, end);
      const cut = Math.max(seg.lastIndexOf('\n\n'), seg.lastIndexOf('. '), seg.lastIndexOf('\n'), seg.lastIndexOf(' '));
      if (cut > size * 0.5) end = i + cut + 1;
    }
    out.push(t.slice(i, end));
    i = end;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(text) {
  const chunks = chunk(text, 1000).filter((c) => c.trim());
  const all = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    if (idx > 0) await sleep(1000);
    const html = await fetchResults(chunks[idx]);
    const errs = parse(html);
    if (errs === null) { const e = new Error('검사기 응답을 해석하지 못했습니다'); e.code = 'PARSE'; throw e; }
    all.push(...errs);
  }
  const seen = new Set();
  return all.filter((e) => {
    const k = e.orig + '|' + e.help;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { check, parse, chunk };
