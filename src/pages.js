// Server-rendered pages in the co-pilot.ai look (dark, copper). No frontend build step.
import { esc, mdToHtml } from './util.js';

const CSS = `
:root{--copper:#C27D56;--copper-l:#DF9B74;--copper-d:#A15F3A;--dark:#070708;--d2:#0E0E10;--d3:#141417;--gray:#8E9095;--light:#ECECEE;--teal:#49C6B2;--line:rgba(255,255,255,.08)}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;background:var(--dark);color:var(--light);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--copper-l)}h1,h2,h3{font-family:'Playfair Display',Georgia,serif;color:#fff;line-height:1.15}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}nav{border-bottom:1px solid var(--line);background:rgba(7,7,8,.9);position:sticky;top:0;z-index:5;backdrop-filter:blur(12px)}
nav .wrap{display:flex;justify-content:space-between;align-items:center;height:60px}.logo{font-family:'Playfair Display',serif;font-weight:800;font-size:1.25rem;color:#fff;text-decoration:none}.logo span{color:var(--copper)}
.btn{display:inline-block;background:var(--copper);color:#fff;border:0;border-radius:8px;padding:.8rem 1.4rem;font-weight:600;font-size:.95rem;cursor:pointer;text-decoration:none;font-family:inherit}.btn:hover{background:var(--copper-d)}
.btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.18)}.btn.block{width:100%;text-align:center}
section{padding:64px 0;border-bottom:1px solid var(--line)}.tag{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--copper-l);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
.hero h1{font-size:3rem;margin-bottom:18px}.hero p{font-size:1.15rem;color:var(--gray);max-width:640px;margin-bottom:28px}.accent{background:linear-gradient(135deg,var(--copper),#E5A93B);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.card{background:var(--d3);border:1px solid var(--line);border-radius:10px;padding:24px}.card h3{font-size:1.2rem;margin-bottom:8px}.card p,.card li{color:var(--gray);font-size:.95rem}
.price{font-family:'JetBrains Mono',monospace;font-size:2.4rem;font-weight:700;color:#fff}.price small{font-size:.9rem;color:var(--gray)}.card ul{list-style:none;margin:14px 0 20px}.card li{padding:5px 0}.card li:before{content:'\\2713  ';color:var(--teal)}
.card.pro{border-color:rgba(194,125,86,.5)}.h2{font-size:2.1rem;margin-bottom:10px}.sub{color:var(--gray);max-width:640px;margin-bottom:28px}
form .row{margin-bottom:14px}label{display:block;font-size:.85rem;color:var(--gray);margin-bottom:5px}input,select,textarea{width:100%;background:var(--d2);color:var(--light);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:.7rem .8rem;font-family:inherit;font-size:.95rem}textarea{min-height:84px}
.narrow{max-width:620px;margin:0 auto}.muted{color:var(--gray);font-size:.88rem}.drop h2{font-size:1.35rem;margin:26px 0 8px}.drop p,.drop li{color:#d6d6d9}.drop ul,.drop ol{margin:6px 0 6px 22px}
.drop pre{background:var(--d2);border:1px solid var(--line);border-radius:8px;padding:14px;white-space:pre-wrap;font-family:'JetBrains Mono',monospace;font-size:.85rem;margin:10px 0;color:var(--light)}
.list a{display:block;padding:12px 0;border-bottom:1px solid var(--line);text-decoration:none;color:var(--light)}.list a span{color:var(--gray);font-size:.82rem;margin-left:8px}
.flash{background:rgba(73,198,178,.1);border:1px solid rgba(73,198,178,.35);color:#bdf0e6;padding:12px 14px;border-radius:8px;margin-bottom:18px}.video{position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;border:1px solid var(--line)}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.span2{grid-column:span 2}footer{padding:28px 0;color:var(--gray);font-size:.82rem}@media(max-width:640px){.hero h1{font-size:2.2rem}section{padding:44px 0}.span2{grid-column:auto}}`;

export function layout(env, { title, body, nav = true, authed = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · Co-Pilot</title><meta name="description" content="Every week, the way a frontier AI practitioner actually used AI — rebuilt for your job."/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet"/>
<style>${CSS}</style></head><body>
${nav ? `<nav><div class="wrap"><a class="logo" href="/">Co-Pilot<span>.ai</span> <span style="font-family:'Plus Jakarta Sans';font-size:.8rem;color:var(--gray);font-weight:500">AI Coaching</span></a><div>${authed ? '<a href="/logout" style="margin-right:16px;text-decoration:none;color:var(--gray)">Sign out</a><a class="btn" href="/portal">Portal</a>' : '<a href="/login" style="margin-right:16px;text-decoration:none;color:var(--gray)">Sign in</a><a class="btn" href="/#pricing">Subscribe</a>'}</div></div></nav>` : ''}
${body}
<footer><div class="wrap">Co-Pilot is operated by ${esc(env.LEGAL_ENTITY || 'Phase 2 Labs LLC')}. AI coaching only — not legal, financial or medical advice. · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a></div></footer>
</body></html>`;
}

export function landingPage(env) {
  const core = Number(env.CORE_PRICE || 50), m = Math.max(parseInt(env.COMMITMENT_MONTHS ?? '0', 10) || 0, 0);
  return layout(env, { title: 'Your AI week, rebuilt for your job', body: `
<section class="hero"><div class="wrap"><div class="tag">Adaptive AI coaching · weekly</div>
<h1>You're not using AI the way the builders are.<br/><span class="accent">Every week, we show you how they are.</span></h1>
<p>Each week our engine captures how a frontier AI practitioner actually used AI — the tools, agents, prompts and workflows — and rebuilds it for <strong>your</strong> role, industry and goals. Ready-to-run prompts in your inbox. No setup. No course.</p>
<a class="btn" href="#pricing">Start my weekly drop</a> &nbsp; <a class="btn ghost" href="#sample">Get a free sample</a></div></section>

<section><div class="wrap"><div class="tag">How it works</div><h2 class="h2">One real week of AI use. Rebuilt for you.</h2><p class="sub">Every instance is unique: the same source week becomes a different drop for a law partner, an investor or a real-estate operator.</p>
<div class="grid">
<div class="card"><h3>1. We capture</h3><p>How Shawn Cutter and the Co-Pilot community used AI this week — Claude, ChatGPT/Codex, Gemini, Grok, open-source models, agents — plus what the AI masters shipped.</p></div>
<div class="card"><h3>2. We adapt</h3><p>Your profile (role, industry, tools, goals) turns that week into prompts and moves for your job. Client details are scrubbed; a second model checks every drop.</p></div>
<div class="card"><h3>3. You run it</h3><p>Monday morning: the one thing to try today, ready-to-run prompts, the tool of the week, and the walkthrough videos. Want hands-on help? Request a 1:1 session.</p></div>
</div></div></section>

<section id="sample"><div class="wrap narrow"><div class="tag">Free sample</div><h2 class="h2">See your own drop before you pay.</h2><p class="sub">Tell us about your work and we'll generate a one-time sample built from this week's engine. One per person.</p>
<form method="post" action="/api/sample">
<div class="row"><label>Email</label><input name="email" type="email" required/></div>
<div class="row"><label>Your role</label><input name="role" placeholder="e.g. Managing partner" required/></div>
<div class="row"><label>Industry / organization</label><input name="industry" placeholder="e.g. 12-attorney litigation firm" required/></div>
<div class="row"><label>What do you want AI to do for you?</label><textarea name="goals" placeholder="e.g. Cut intake time, draft first-pass memos, prep for depositions" required></textarea></div>
<button class="btn block" type="submit">Generate my sample</button></form></div></section>

<section id="pricing"><div class="wrap"><div class="tag">Pricing</div><h2 class="h2">Simple pricing.</h2><p class="sub">Billed by ${esc(env.LEGAL_ENTITY || 'Phase 2 Labs LLC')} via Stripe.</p>
<div class="grid">
<div class="card pro"><h3>Co-Pilot membership</h3><div class="price">$${esc(core)}<small>/month</small></div><ul><li>Your personalized briefing, every Monday</li><li>Starter package: setup checklist, first 30 days and starter prompts for your role</li><li>Portal archive of every briefing</li><li>Full walkthrough video library</li></ul>
<form method="post" action="/api/checkout"><label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:14px;font-size:.9rem;color:var(--light)"><input type="checkbox" name="agree" value="yes" required style="width:auto;margin-top:4px"/> ${m ? `I understand the ${m}-month minimum ($${esc(core * m)} total), then month to month.` : 'I understand I can cancel anytime and payments are non-refundable.'}</label><button class="btn block">Join — $${esc(core)}/mo</button></form></div>
<div class="card"><h3>1:1 sessions</h3><div class="price" style="font-size:1.7rem">Request pricing</div><ul><li>Work directly with a practitioner</li><li>Strategy, setup or a hands-on working session</li><li>Open to members and non-members</li></ul>
<a class="btn ghost block" href="/consulting">Request pricing</a></div>
</div></div></section>

<section><div class="wrap narrow"><div class="tag">FAQ</div>
<h3>Is this a course?</h3><p class="muted" style="margin-bottom:16px">No. It's a live feed of how AI is actually being used this week, rebuilt for your work. It changes every week because the frontier does.</p>
<h3>Do I have to set anything up?</h3><p class="muted" style="margin-bottom:16px">No. Two minutes on a profile after checkout. Then it arrives every Monday.</p>
${m ? `<h3>What's the commitment?</h3><p class="muted" style="margin-bottom:16px">Membership has a ${m}-month minimum ($${esc(core * m)} in total). After that it's month to month and you can cancel in one click from your portal. If you cancel during the first ${m} months, your membership simply runs to the end of month ${m}.</p>` : `<h3>Can I cancel?</h3><p class="muted" style="margin-bottom:16px">Anytime, in one click from your portal. Cancelling stops the next charge and you keep access until the end of the month you've paid for. Payments aren't refunded, including for part of a month.</p>`}
<h3>What's in the starter package?</h3><p class="muted" style="margin-bottom:16px">Right after you sign up: a setup checklist for the tools you already use, a 30-day plan, ten starter prompts written for your role, and your first quick win. Then your briefing arrives every Monday.</p>
<h3>Is this legal or financial advice?</h3><p class="muted">No. It's AI coaching. For regulated decisions, work with your counsel or advisor.</p>
</div></section>` });
}

export function samplePage(env, { subject, body, repeat }) {
  return layout(env, { title: 'Your free sample', body: `<section><div class="wrap narrow">
${repeat ? '<div class="flash">You already have your free sample — here it is again. Subscribe to get a fresh one every week.</div>' : ''}
<div class="tag">Your one-time sample</div><h1 style="font-size:2rem;margin-bottom:8px">${esc(subject || 'Your AI week')}</h1>
<div class="drop">${mdToHtml(body)}</div>
<div class="card" style="margin-top:30px"><h3>Want this every week?</h3><p>Subscribers get a new drop every Monday, built from that week's real AI use.</p><br/><a class="btn" href="/#pricing">Subscribe</a></div>
</div></section>` });
}

export function intakePage(env, { email, plan, sessionId, error }) {
  return layout(env, { title: 'Personalize your drop', body: `<section><div class="wrap narrow">
<div class="tag">2 minutes</div><h1 style="font-size:2rem;margin-bottom:10px">Tell us about your work.</h1>
<p class="muted" style="margin-bottom:22px">This is what makes your drop yours. You can edit it anytime from your portal.</p>
${error ? `<div class="flash" style="border-color:#e06c75;color:#ffc9cd;background:rgba(224,108,117,.1)">${esc(error)}</div>` : ''}
<form method="post" action="/api/intake">
<input type="hidden" name="session_id" value="${esc(sessionId || '')}"/>
<div class="row"><label>Email</label><input name="email" type="email" value="${esc(email || '')}" required/></div>
<div class="row"><label>Your name</label><input name="name"/></div>
${profileFields({})}
<button class="btn block" type="submit">Send my starter package</button>
<p class="muted" style="margin-top:10px">Co-Pilot membership</p></form></div></section>` });
}

export function profileFields(p) {
  const opt = (v, cur, label) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
  return `<div class="row"><label>Your role</label><input name="role" value="${esc(p.role || '')}" placeholder="e.g. Managing partner" required/></div>
<div class="row"><label>Industry / organization</label><input name="industry" value="${esc(p.industry || '')}" placeholder="e.g. 12-attorney litigation firm" required/></div>
<div class="row"><label>Tools you use today</label><input name="tools" value="${esc(p.tools || '')}" placeholder="e.g. Outlook, Clio, ChatGPT free"/></div>
<div class="row"><label>What do you want AI to do for you?</label><textarea name="goals" required>${esc(p.goals || '')}</textarea></div>
<div class="row"><label>How do you use AI today?</label><select name="ai_level">${opt('new', p.ai_level, 'Barely / just starting')}${opt('some', p.ai_level, 'A few times a week')}${opt('daily', p.ai_level, 'Daily, want to go deeper')}</select></div>
<div class="row"><label>Industry pack</label><select name="vertical">${opt('general', p.vertical, 'General')}${opt('legal', p.vertical, 'Legal')}${opt('investing', p.vertical, 'Investing / VC')}${opt('real_estate', p.vertical, 'Real estate')}${opt('energy', p.vertical, 'Energy & infrastructure')}</select></div>`;
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

function membershipCard(env, sub) {
  const m = Math.max(parseInt(env.COMMITMENT_MONTHS ?? '0', 10) || 0, 0);
  const inTerm = sub.commitment_ends_at && new Date(sub.commitment_ends_at).getTime() > Date.now();
  const term = inTerm
    ? `${m}-month minimum through ${esc(fmtDate(sub.commitment_ends_at))}. After that it's month to month.`
    : 'Month to month. Cancel anytime. Payments are non-refundable.';
  const action = sub.cancels_at
    ? `<p>Your membership ends on <strong>${esc(fmtDate(sub.cancels_at))}</strong>. Full access until then.</p>`
    : `<form method="post" action="/api/portal/cancel"><button class="btn ghost block">Cancel membership</button></form>`;
  return `<div class="card"><h3>Membership</h3><p>${term}</p><br/>${action}<br/>
<form method="post" action="/api/portal/billing"><button class="btn ghost block">Update card or download receipts</button></form><br/><a href="/logout" class="muted">Sign out</a></div>`;
}

export function portalPage(env, { sub, profiles, drops, flash, canAddProfile, videos }) {
  return layout(env, { title: 'Your portal', authed: true, body: `<section><div class="wrap">
${flash ? `<div class="flash">${esc(flash)}</div>` : ''}
<div class="tag">Co-Pilot member · ${esc(sub.status)}</div>
<h1 style="font-size:2rem;margin-bottom:22px">Welcome back${sub.name ? ', ' + esc(sub.name) : ''}.</h1>
<div class="grid">
<div class="card span2"><h3>Your drops</h3><div class="list">${drops.length ? drops.map((d) => `<a href="/drop/${d.id}">${esc(d.subject)}<span>${esc(d.week_id)} · ${esc(d.kind)}</span></a>`).join('') : '<p>Your first drop is on its way.</p>'}</div></div>
<div class="card"><h3>1:1 session</h3><p>Work directly with a practitioner on anything in your briefings. Tell us what you need and we'll reply with pricing and times.</p><br/>
<form method="post" action="/api/consulting/request"><div class="row"><label>What do you want to work on?</label><textarea name="topic" required></textarea></div>
<div class="row"><label>When suits you?</label><input name="timing" placeholder="e.g. weekday mornings"/></div><button class="btn block">Request pricing</button></form></div>
</div>
<div class="grid" style="margin-top:18px">
${profiles.map((p) => `<div class="card"><h3>Profile: ${esc(p.label)}</h3><form method="post" action="/api/profile"><input type="hidden" name="profile_id" value="${esc(p.id)}"/>${profileFields(p)}<button class="btn ghost block">Save profile</button></form></div>`).join('')}
${canAddProfile ? `<div class="card"><h3>Add a second use case</h3><p>Add a second use case — e.g. your firm and your board seat.</p><br/><form method="post" action="/api/profile"><div class="row"><label>Label</label><input name="label" placeholder="e.g. Board work" required/></div>${profileFields({})}<button class="btn block">Add profile</button></form></div>` : ''}
${membershipCard(env, sub)}
</div>
${videos.length ? `<div style="margin-top:34px"><div class="tag">Walkthrough library</div><h2 class="h2" style="font-size:1.6rem">How Shawn works, on screen</h2><div class="grid">${videos.map((v) => `<div class="card"><h3 style="font-size:1rem">${esc(v.title)}</h3><br/><div class="video"><iframe src="${esc(v.url)}" allowfullscreen loading="lazy"></iframe></div></div>`).join('')}</div></div>` : ''}
</div></section>` });
}

export function dropPage(env, { drop }) {
  return layout(env, { title: drop.subject, authed: true, body: `<section><div class="wrap narrow"><a href="/portal" class="muted">&larr; Portal</a>
<div class="tag" style="margin-top:14px">${esc(drop.week_id)}</div><h1 style="font-size:2rem;margin-bottom:8px">${esc(drop.subject)}</h1><div class="drop">${mdToHtml(drop.body_md)}</div>
<div class="card" style="margin-top:30px"><h3>Want help implementing this?</h3><p>Request a 1:1 session with a practitioner.</p><br/><a class="btn" href="/consulting">Request pricing</a></div></div></section>` });
}

export function messagePage(env, { title, message, cta }) {
  return layout(env, { title, body: `<section><div class="wrap narrow"><h1 style="font-size:2rem;margin-bottom:12px">${esc(title)}</h1><p class="muted" style="font-size:1rem">${esc(message)}</p>${cta ? `<br/><a class="btn" href="${esc(cta.href)}">${esc(cta.label)}</a>` : ''}</div></section>` });
}

export function loginPage(env, { sent } = {}) {
  return layout(env, { title: 'Sign in', body: `<section><div class="wrap narrow"><div class="tag">Sign in</div><h1 style="font-size:2rem;margin-bottom:14px">Get your secure link.</h1>
${sent ? '<div class="flash">If that email has a subscription, a sign-in link is on its way.</div>' : ''}
<form method="post" action="/api/login"><div class="row"><label>Email</label><input name="email" type="email" required/></div><button class="btn block">Email me a link</button></form></div></section>` });
}

export function consultingPage(env, { error, values = {} } = {}) {
  return layout(env, { title: '1:1 sessions', body: `<section><div class="wrap narrow"><div class="tag">1:1 sessions</div><h1 style="font-size:2rem;margin-bottom:10px">Work directly with a practitioner.</h1>
<p class="muted" style="margin-bottom:20px">Strategy, setup or a hands-on working session. Tell us what you want to work on and we'll reply with pricing and a few times that work.</p>
${error ? `<div class="flash" style="border-color:#e06c75;color:#ffc9cd;background:rgba(224,108,117,.1)">${esc(error)}</div>` : ''}
<form method="post" action="/api/consulting/request">
<div class="row"><label>Name</label><input name="name" value="${esc(values.name || '')}"/></div>
<div class="row"><label>Email</label><input name="email" type="email" value="${esc(values.email || '')}" required/></div>
<div class="row"><label>Company</label><input name="company" value="${esc(values.company || '')}"/></div>
<div class="row"><label>What do you want to work on?</label><textarea name="topic" required>${esc(values.topic || '')}</textarea></div>
<div class="row"><label>When suits you?</label><input name="timing" value="${esc(values.timing || '')}" placeholder="e.g. weekday mornings, next two weeks"/></div>
<button class="btn block">Request pricing</button></form></div></section>` });
}

export function legalPage(env, kind) {
  const entity = esc(env.LEGAL_ENTITY || 'Phase 2 Labs LLC');
  const contact = esc(env.EMAIL_REPLY_TO || 'support@co-pilot.ai');
  const docs = {
    terms: ['Terms of Service', `These terms govern Co-Pilot, a subscription service operated by ${entity}. The service provides AI coaching content for informational and educational purposes only and is not legal, financial, medical or other professional advice. Memberships are billed monthly and renew each month until canceled. You can cancel anytime; cancellation takes effect at the end of the current billing period and no further charges are made. Membership payments are non-refundable, including for partial months. 1:1 sessions are quoted on request and billed separately. Content is licensed for your personal and internal business use. ${entity} may update these terms with notice. Questions: ${contact}. [DRAFT — have counsel review before launch.]`],
    privacy: ['Privacy Policy', `${entity} collects your email, the profile you provide, and billing details handled by Stripe (we never see your full card number). Your profile is used only to personalize your coaching drops and is sent to AI model providers solely for that purpose. We do not sell your data. Email ${contact} to access or delete your data. [DRAFT — have counsel review before launch.]`],
    refunds: ['Refund Policy', `Membership payments are non-refundable, including for partial months, except where required by law. You can cancel anytime; cancellation stops future charges and access continues through the period you have paid for. Paid 1:1 session time that has not been scheduled can be refunded within 30 days of payment on request to ${contact}. [DRAFT — set your final policy and have counsel review before launch.]`],
  };
  const [title, text] = docs[kind];
  return layout(env, { title, body: `<section><div class="wrap narrow"><h1 style="font-size:2rem;margin-bottom:14px">${title}</h1><p class="muted" style="font-size:1rem">${text}</p></div></section>` });
}
