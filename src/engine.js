// The weekly engine: capture -> redact -> digest (+ frontier) -> adapt per subscriber -> QA -> deliver.
import { uuid, weekId } from './util.js';
import { all, first, run, getProfile, getSubscriber, promptCount, profileSummary } from './db.js';
import { runTask } from './models.js';
import { DIGEST, FRONTIER, ADAPT, QA, TEASER, SAMPLE, STARTER, splitSubject } from './prompts.js';
import { redact } from './redact.js';
import { fetchFrontierHeadlines } from './capture.js';
import { sendEmail, dropEmail, opsAlertEmail } from './email.js';
import { signToken } from './auth.js';

// ---------- 1. Build the week (once) ----------
export async function buildWeek(env, db, now = new Date()) {
  const id = weekId(now);
  const existing = await first(db, 'SELECT * FROM weeks WHERE id = ?', id);
  if (existing) return existing;

  const since = new Date(now.getTime() - 8 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const items = await all(
    db,
    'SELECT * FROM capture_items WHERE week_id IS NULL AND captured_at >= ? ORDER BY captured_at',
    since
  );

  // Redact every item before any model that writes subscriber-facing text sees it.
  const clean = [];
  for (const it of items) clean.push({ ...it, body: await redact(env, `${it.title || ''}\n${it.body}`) });

  // Frontier feed: practitioner RSS + Grok scanning X.
  const headlines = await fetchFrontierHeadlines(env, now.getTime());
  let frontier = '';
  try {
    frontier = (await runTask(env, 'frontier', {
      system: FRONTIER.system, prompt: FRONTIER.prompt(headlines), maxTokens: 1200,
    })).text;
  } catch { frontier = headlines.slice(0, 8).map((h) => `- ${h.title}${h.url ? ` (${h.url})` : ''}`).join('\n'); }

  // Digest of Shawn's week. Quiet week? The frontier backfills so a drop still ships.
  let digest;
  if (clean.length) {
    digest = (await runTask(env, 'digest', {
      system: DIGEST.system, prompt: DIGEST.prompt(clean), maxTokens: 2500,
    })).text;
  } else {
    digest = `## Patterns this week\n(Quiet week on the capture side — this drop leans on the frontier feed.)\n\n${frontier}`;
  }

  let teaser = '';
  try {
    teaser = (await runTask(env, 'teaser', { system: TEASER.system, prompt: TEASER.prompt({ digest, frontier }), maxTokens: 300 })).text.slice(0, 280);
  } catch { /* optional */ }

  await run(db, 'INSERT OR IGNORE INTO weeks (id, digest, frontier, teaser) VALUES (?, ?, ?, ?)', id, digest, frontier, teaser);
  for (const it of items) await run(db, 'UPDATE capture_items SET week_id = ? WHERE id = ?', id, it.id);
  return first(db, 'SELECT * FROM weeks WHERE id = ?', id);
}

// ---------- 2. Write one drop (adapt + QA, one revision if QA fails) ----------
export async function writeDrop(env, { profile, plan, week, kind = 'weekly' }) {
  const isSample = kind === 'sample';
  const isStarter = kind === 'welcome'; // the starter package every new member receives
  const args = {
    profile,
    digest: week.digest,
    frontier: week.frontier,
    promptCount: isSample ? 2 : isStarter ? 10 : promptCount(plan),
    vertical: profile.vertical && profile.vertical !== 'general' ? profile.vertical : null,
  };
  const system = isSample ? SAMPLE.system : isStarter ? STARTER.system : ADAPT.system;
  const task = isSample ? 'sample' : isStarter ? 'starter' : 'adapt';
  let draft = (await runTask(env, task, { system, prompt: ADAPT.prompt(args), maxTokens: isStarter ? 5000 : 3500 })).text;

  let qaNotes = '';
  try {
    const qa = (await runTask(env, 'qa', { system: QA.system, prompt: QA.prompt({ profile, draft }), maxTokens: 800 })).text;
    qaNotes = qa;
    if (/^\s*FAIL/i.test(qa)) {
      draft = (await runTask(env, task, {
        system, prompt: ADAPT.prompt({ ...args, revision: qa.replace(/^\s*FAIL\s*/i, '') }), maxTokens: isStarter ? 5000 : 3500,
      })).text;
      qaNotes += '\n[revised once]';
    }
  } catch (e) {
    qaNotes = `QA skipped: ${e.message}`;
  }
  return { ...splitSubject(draft, isStarter ? 'Your Co-Pilot starter package' : undefined), qaNotes };
}

// ---------- 3. Deliver a drop to one subscriber profile (idempotent) ----------
export async function processDrop(env, db, { profileId, weekId: wid, kind = 'weekly' }) {
  const profile = await getProfile(db, profileId);
  if (!profile) return { skipped: 'no profile' };
  const sub = await getSubscriber(db, profile.subscriber_id);
  if (!sub || (sub.status !== 'active' && kind === 'weekly')) return { skipped: 'inactive' };

  const done = await first(db, 'SELECT id, emailed_at FROM drops WHERE profile_id = ? AND week_id = ? AND kind = ?', profileId, wid, kind);
  if (done?.emailed_at) return { skipped: 'already sent', dropId: done.id };

  const week = await first(db, 'SELECT * FROM weeks WHERE id = ?', wid);
  if (!week) throw new Error(`week ${wid} missing`);

  let dropId = done?.id;
  let subject, body;
  if (!dropId) {
    const d = await writeDrop(env, { profile, plan: sub.plan, week, kind });
    subject = d.subject; body = d.body;
    dropId = uuid();
    await run(db,
      'INSERT OR IGNORE INTO drops (id, subscriber_id, profile_id, week_id, kind, subject, body_md, qa_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      dropId, sub.id, profileId, wid, kind, subject, body, d.qaNotes);
    const row = await first(db, 'SELECT id FROM drops WHERE profile_id = ? AND week_id = ? AND kind = ?', profileId, wid, kind);
    dropId = row.id;
  } else {
    const row = await first(db, 'SELECT subject, body_md FROM drops WHERE id = ?', dropId);
    subject = row.subject; body = row.body_md;
  }

  const token = await signToken(env.SESSION_SECRET, sub.id);
  const portalUrl = `${env.APP_URL}/drop/${dropId}?t=${encodeURIComponent(token)}`;
  const label = profile.label && profile.label !== 'Primary' ? ` · ${profile.label}` : '';
  const mail = dropEmail(env, { subject: subject + label, bodyMd: body, portalUrl });
  await sendEmail(env, { to: sub.email, ...mail });
  await run(db, "UPDATE drops SET emailed_at = datetime('now') WHERE id = ?", dropId);
  return { sent: true, dropId };
}

// ---------- 4. The weekly run (cron) ----------
export async function weeklyRun(env, db, now = new Date()) {
  const week = await buildWeek(env, db, now);
  const profiles = await all(
    db,
    `SELECT p.id FROM profiles p JOIN subscribers s ON s.id = p.subscriber_id WHERE s.status = 'active'`
  );
  let queued = 0;
  if (env.DROP_QUEUE) {
    // Fan out: one queue message per profile so a big list never hits a time limit.
    for (const p of profiles) { await env.DROP_QUEUE.send({ profileId: p.id, weekId: week.id }); queued++; }
  } else {
    for (const p of profiles) {
      try { await processDrop(env, db, { profileId: p.id, weekId: week.id }); queued++; }
      catch (e) { await alertOps(env, 'Drop failed', `${p.id}: ${e.message}`); }
    }
  }
  if (week.teaser) await postTeaser(env, week.teaser);
  return { week: week.id, profiles: profiles.length, queued };
}

// Welcome drops and samples reuse the most recent week so they never consume capture
// items early (those belong to Monday's main drop). Only at first launch is a week built.
export async function latestWeek(env, db, now = new Date()) {
  const last = await first(db, 'SELECT * FROM weeks ORDER BY created_at DESC LIMIT 1');
  return last || buildWeek(env, db, now);
}

// ---------- 5. Instant first drop right after intake ----------
export async function welcomeDrop(env, db, profileId, now = new Date()) {
  const week = await latestWeek(env, db, now);
  return processDrop(env, db, { profileId, weekId: week.id, kind: 'welcome' });
}

// ---------- 6. Free one-time sample ("the wow, then it stops") ----------
export async function sampleDrop(env, db, { email, profile }, now = new Date()) {
  const key = email.toLowerCase().trim();
  const prior = await first(db, 'SELECT * FROM samples WHERE email = ?', key);
  if (prior?.body_md) return { body: prior.body_md, repeat: true };
  const week = await latestWeek(env, db, now);
  const d = await writeDrop(env, { profile, plan: 'core', week, kind: 'sample' });
  await run(db, 'INSERT OR REPLACE INTO samples (email, profile, body_md) VALUES (?, ?, ?)', key, JSON.stringify(profile), d.body);
  return { subject: d.subject, body: d.body, repeat: false };
}

// ---------- Grok bot: optional public teaser on X ----------
export async function postTeaser(env, text) {
  if (!env.X_USER_ACCESS_TOKEN || env.X_POSTING !== '1') return { skipped: true };
  try {
    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.X_USER_ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${text}`.slice(0, 280) }),
    });
    return { posted: res.ok };
  } catch (e) {
    return { posted: false, error: e.message };
  }
}

export async function alertOps(env, subject, detail) {
  if (!env.OPS_ALERT_EMAIL) return;
  try { await sendEmail(env, { to: env.OPS_ALERT_EMAIL, ...opsAlertEmail(env, { subject, detail }) }); } catch { /* ignore */ }
}

export { profileSummary };
