// Getting "how Shawn used AI this week" into the system with zero manual effort.
//  - POST /api/capture   (Claude scheduled task reading Day/SecondBrain, Zapier, iOS Shortcut…)
//  - Inbound email       (Gmail filter auto-forwards AI Saturday recaps / Day summaries)
//  - Frontier feeds      (RSS/Atom from AI practitioners, pulled by the weekly job)
import { uuid } from './util.js';
import { run } from './db.js';

const MAX_BODY = 20000;

export async function saveCapture(db, { source, title, body, url }) {
  const text = String(body || '').trim();
  if (!text) return null;
  const id = uuid();
  await run(
    db,
    'INSERT INTO capture_items (id, source, title, body, url) VALUES (?, ?, ?, ?, ?)',
    id, source, (title || '').slice(0, 300), text.slice(0, MAX_BODY), url || null
  );
  return id;
}

// Inbound email handler: only accept mail from addresses you allow-list.
export async function captureFromEmail(env, db, message) {
  const allowed = (env.CAPTURE_EMAIL_FROM || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const from = String(message.from || '').toLowerCase();
  if (!allowed.length || !allowed.some((a) => from.includes(a))) return { ok: false, reason: 'sender not allowed' };
  const { default: PostalMime } = await import('postal-mime');
  const parsed = await PostalMime.parse(message.raw);
  const body = parsed.text || (parsed.html || '').replace(/<[^>]+>/g, ' ');
  const id = await saveCapture(db, { source: 'email', title: parsed.subject || 'Forwarded note', body });
  return { ok: !!id, id };
}

export const DEFAULT_FEEDS = [
  'https://simonwillison.net/atom/everything/',
  'https://www.oneusefulthing.org/feed',
];

// Minimal RSS/Atom parsing — titles, links, dates. Returns items from the last `days` days.
export function parseFeed(xml, days = 7, now = Date.now()) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : '';
    };
    const title = pick('title');
    let url = pick('link');
    if (!url) {
      const m = b.match(/<link\b[^>]*href=["']([^"']+)["']/i);
      url = m ? m[1] : '';
    }
    const dateStr = pick('pubDate') || pick('published') || pick('updated') || pick('dc:date');
    const t = Date.parse(dateStr);
    if (title && (!t || now - t <= days * 86400000)) items.push({ title, url, date: dateStr });
  }
  return items;
}

export async function fetchFrontierHeadlines(env, now = Date.now()) {
  const feeds = env.FRONTIER_FEEDS ? env.FRONTIER_FEEDS.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_FEEDS;
  const out = [];
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const res = await fetch(f, { headers: { 'user-agent': 'CoPilotsCoach/1.0 (+https://co-pilot.ai)' } });
        if (res.ok) out.push(...parseFeed(await res.text(), 7, now).slice(0, 15));
      } catch {
        /* a dead feed never blocks the week */
      }
    })
  );
  return out.slice(0, 40);
}
