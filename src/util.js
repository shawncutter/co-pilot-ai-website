// Small shared helpers. No dependencies; runs in Workers and Node 22.

export const uuid = () => crypto.randomUUID();

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const html = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

export const redirect = (url, status = 303) =>
  new Response(null, { status, headers: { location: url } });

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ISO week id, e.g. "2026-W42" — one digest per week.
export function weekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export async function readForm(request) {
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await request.json();
  const fd = await request.formData();
  return Object.fromEntries(fd.entries());
}

const enc = new TextEncoder();

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Tiny, safe markdown -> HTML for drops (headings, bold, italics, lists, code, links).
export function mdToHtml(md) {
  const lines = esc(md || '').split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  let code = false;
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('```')) {
      close();
      out.push(code ? '</pre>' : '<pre>');
      code = !code;
      continue;
    }
    if (code) { out.push(line); continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      close();
      const lvl = Math.min(m[1].length + 1, 4);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (line.trim() === '') {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  if (code) out.push('</pre>');
  return out.join('\n');
}
