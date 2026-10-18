// Co-Pilot — Phase 2 Labs LLC
// Cloudflare Worker: web app + Stripe webhooks + weekly cron + drop queue + inbound email capture.
import { json, html, redirect, readForm, isEmail, uuid, safeEqual } from './util.js';
import { signToken, verifyToken } from './auth.js';
import {
  createSubscriptionCheckout, createBillingPortal, scheduleCancel,
  getCheckoutSession, verifyStripeSignature, commitmentMonths, addMonths,
} from './stripe.js';
import { all, first, run, getSubscriber, getSubscriberByEmail, getProfiles, profileLimit, profileSummary } from './db.js';
import { saveCapture, captureFromEmail } from './capture.js';
import { weeklyRun, processDrop, welcomeDrop, sampleDrop, alertOps } from './engine.js';
import { configuredProviders } from './models.js';
import {
  sendEmail, magicLinkEmail, welcomeIntakeEmail, consultingAlertEmail, consultingConfirmEmail,
  consultingRequestAlertEmail, consultingRequestAckEmail,
} from './email.js';
import * as P from './pages.js';

const COOKIE = 'cp_session';
const cookieHeader = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

async function session(request, env, url) {
  const fromQuery = url.searchParams.get('t');
  const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  const token = fromQuery || (cookie ? cookie.slice(COOKIE.length + 1) : null);
  const sid = await verifyToken(env.SESSION_SECRET, token);
  if (!sid) return null;
  const sub = await getSubscriber(env.DB, sid);
  return sub ? { sub, token, fromQuery: !!fromQuery } : null;
}

const PROFILE_KEYS = ['role', 'industry', 'tools', 'goals', 'ai_level', 'vertical'];
const pickProfile = (f) => Object.fromEntries(PROFILE_KEYS.map((k) => [k, String(f[k] || '').slice(0, 1000)]));

function mapStatus(s) {
  if (['active', 'trialing'].includes(s)) return 'active';
  if (['past_due', 'unpaid', 'incomplete'].includes(s)) return 'past_due';
  return 'canceled';
}

async function upsertSubscriber(db, { email, plan, customer, subscription, status, name }) {
  const key = email.toLowerCase().trim();
  const existing = await getSubscriberByEmail(db, key);
  if (existing) {
    await run(db,
      `UPDATE subscribers SET plan = COALESCE(?, plan), status = COALESCE(?, status),
        stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_sub_id = COALESCE(?, stripe_sub_id),
        name = COALESCE(NULLIF(?, ''), name), updated_at = datetime('now') WHERE id = ?`,
      plan || null, status || null, customer || null, subscription || null, name || '', existing.id);
    return getSubscriber(db, existing.id);
  }
  const id = uuid();
  await run(db,
    'INSERT INTO subscribers (id, email, name, plan, status, stripe_customer_id, stripe_sub_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, key, name || null, plan || 'core', status || 'active', customer || null, subscription || null);
  return getSubscriber(db, id);
}

// The minimum term starts when the member checks out and is stored once.
async function setCommitment(db, env, sub, createdUnix) {
  if (!sub || sub.commitment_ends_at || !commitmentMonths(env)) return;
  const start = createdUnix ? new Date(createdUnix * 1000) : new Date();
  const ends = addMonths(start, commitmentMonths(env)).toISOString();
  await run(db, "UPDATE subscribers SET commitment_ends_at = ?, updated_at = datetime('now') WHERE id = ?", ends, sub.id);
}

// A paid 1:1 session: either a checkout tagged as consulting, or the private payment link.
const isConsultingPayment = (env, obj) =>
  obj.metadata?.product === 'consulting' || (!!env.STRIPE_CONSULTING_LINK && obj.payment_link === env.STRIPE_CONSULTING_LINK);

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

// ---------------- Stripe webhook ----------------
async function handleStripeWebhook(request, env, ctx) {
  const body = await request.text();
  const ok = await verifyStripeSignature(body, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Invalid signature', { status: 400 });
  const event = JSON.parse(body);
  const db = env.DB;

  const seen = await first(db, 'SELECT id FROM stripe_events WHERE id = ?', event.id);
  if (seen) return json({ received: true, duplicate: true });
  // The event is recorded as processed only AFTER it succeeds (below), so Stripe's retries still land.

  const obj = event.data?.object || {};
  try {
    if (event.type === 'checkout.session.completed') {
      const email = obj.customer_details?.email || obj.customer_email;
      if (obj.metadata?.product === 'coaching' && email) {
        const sub = await upsertSubscriber(db, {
          email, plan: 'core',
          customer: obj.customer, subscription: obj.subscription, status: 'active', name: obj.customer_details?.name,
        });
        await setCommitment(db, env, sub, obj.created);
        const profiles = await getProfiles(db, sub.id);
        if (!profiles.length) {
          // In case they closed the tab before the intake form: email the intake link.
          const link = `${env.APP_URL}/welcome?session_id=${encodeURIComponent(obj.id)}`;
          ctx.waitUntil(sendEmail(env, { to: sub.email, ...welcomeIntakeEmail(env, { link }) }).catch(() => {}));
        }
      } else if (isConsultingPayment(env, obj) && email) {
        const rateCents = Number(env.CONSULTING_RATE || 500) * 100;
        const hours = parseInt(obj.metadata?.hours || '', 10) || Math.max(1, Math.round((obj.amount_total || 0) / rateCents));
        await run(db, 'INSERT OR IGNORE INTO consulting_orders (id, email, hours, amount_cents, topic) VALUES (?, ?, ?, ?, ?)',
          obj.id, email.toLowerCase(), hours, obj.amount_total || 0, obj.metadata?.topic || '');
        const sub = await getSubscriberByEmail(db, email);
        const prof = sub ? (await getProfiles(db, sub.id))[0] : null;
        const tasks = [sendEmail(env, { to: email, ...consultingConfirmEmail(env, { hours }) })];
        if (env.CONSULTING_ALERT_EMAIL) {
          tasks.push(sendEmail(env, {
            to: env.CONSULTING_ALERT_EMAIL, replyTo: email,
            ...consultingAlertEmail(env, { email, hours, amount: obj.amount_total || 0, topic: obj.metadata?.topic, profileSummary: profileSummary(prof) }),
          }));
        }
        ctx.waitUntil(Promise.all(tasks).catch(() => {}));
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const cancelsAt = obj.cancel_at ? new Date(obj.cancel_at * 1000).toISOString() : null;
      await run(db, "UPDATE subscribers SET status = ?, stripe_sub_id = ?, cancels_at = ?, updated_at = datetime('now') WHERE stripe_customer_id = ?",
        mapStatus(obj.status), obj.id, cancelsAt, obj.customer);
    } else if (event.type === 'customer.subscription.deleted') {
      await run(db, "UPDATE subscribers SET status = 'canceled', updated_at = datetime('now') WHERE stripe_customer_id = ?", obj.customer);
    } else if (event.type === 'invoice.payment_failed') {
      await run(db, "UPDATE subscribers SET status = 'past_due', updated_at = datetime('now') WHERE stripe_customer_id = ?", obj.customer);
    } else if (event.type === 'invoice.paid' && obj.metadata?.product === 'consulting') {
      // A 1:1 invoice sent with scripts/bill-hours.mjs was paid: record it.
      await run(db, 'INSERT OR IGNORE INTO consulting_orders (id, email, hours, amount_cents, topic) VALUES (?, ?, ?, ?, ?)',
        obj.id, (obj.customer_email || '').toLowerCase(), Number(obj.metadata.hours || 1), obj.amount_paid || 0, obj.metadata.topic || '');
    } else if (event.type === 'invoice.paid') {
      await run(db, "UPDATE subscribers SET status = 'active', updated_at = datetime('now') WHERE stripe_customer_id = ? AND status = 'past_due'", obj.customer);
    }
  } catch (e) {
    ctx.waitUntil(alertOps(env, 'Webhook handling error', `${event.type} ${event.id}: ${e.message}`));
    return new Response('handler error', { status: 500 }); // not recorded -> Stripe retries
  }
  await run(db, 'INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)', event.id, event.type);
  return json({ received: true });
}

// ---------------- HTTP router ----------------
async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const db = env.DB;

  // Public pages
  if (method === 'GET' && pathname === '/') return html(P.landingPage(env));
  if (method === 'GET' && pathname === '/consulting') return html(P.consultingPage(env));
  if (method === 'GET' && pathname === '/login') return html(P.loginPage(env));
  if (method === 'GET' && ['/terms', '/privacy', '/refunds'].includes(pathname)) return html(P.legalPage(env, pathname.slice(1)));
  if (method === 'GET' && pathname === '/api/health') {
    return json({ ok: true, entity: env.LEGAL_ENTITY || 'Phase 2 Labs LLC', providers: configuredProviders(env) });
  }

  // Webhooks + automation
  if (method === 'POST' && pathname === '/api/stripe/webhook') return handleStripeWebhook(request, env, ctx);
  if (method === 'POST' && pathname === '/api/capture') {
    const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.CAPTURE_TOKEN || !safeEqual(auth, env.CAPTURE_TOKEN)) return json({ error: 'unauthorized' }, 401);
    const data = await request.json().catch(() => ({}));
    const items = Array.isArray(data.items) ? data.items : [data];
    const ids = [];
    for (const it of items.slice(0, 50)) {
      const id = await saveCapture(db, { source: it.source || 'api', title: it.title, body: it.body, url: it.url });
      if (id) ids.push(id);
    }
    return json({ saved: ids.length, ids });
  }

  // Checkout
  if (method === 'POST' && pathname === '/api/checkout') {
    const f = await readForm(request);
    if (!f.agree) {
      return html(P.messagePage(env, {
        title: 'One more step',
        message: commitmentMonths(env)
          ? `Please confirm the ${commitmentMonths(env)}-month minimum before checkout.`
          : 'Please confirm you understand payments are non-refundable before checkout.',
        cta: { href: '/#pricing', label: 'Back to pricing' },
      }), 400);
    }
    const s = await createSubscriptionCheckout(env, { email: isEmail(f.email) ? f.email : undefined, referral: f.ref });
    return redirect(s.url);
  }
  // 1:1 sessions are quoted, not sold from the page: a request reaches Shawn, who replies with
  // pricing and sends the private payment link or an invoice (scripts/bill-hours.mjs).
  if (method === 'POST' && pathname === '/api/consulting/request') {
    const f = await readForm(request);
    const sess = await session(request, env, url);
    const email = sess?.sub.email || (isEmail(f.email) ? f.email : null);
    if (!email || !String(f.topic || '').trim()) {
      return html(P.consultingPage(env, { error: 'Please add your email and what you want to work on.', values: f }), 400);
    }
    const reqRow = {
      id: uuid(), email: email.toLowerCase().trim(), name: String(f.name || sess?.sub.name || '').slice(0, 120),
      company: String(f.company || '').slice(0, 200), topic: String(f.topic).slice(0, 2000), timing: String(f.timing || '').slice(0, 300),
    };
    await run(db, 'INSERT INTO consulting_requests (id, email, name, company, topic, timing) VALUES (?, ?, ?, ?, ?, ?)',
      reqRow.id, reqRow.email, reqRow.name, reqRow.company, reqRow.topic, reqRow.timing);
    const sub = sess?.sub || await getSubscriberByEmail(db, reqRow.email);
    const prof = sub ? (await getProfiles(db, sub.id))[0] : null;
    const tasks = [sendEmail(env, { to: reqRow.email, ...consultingRequestAckEmail(env, reqRow) })];
    if (env.CONSULTING_ALERT_EMAIL) {
      tasks.push(sendEmail(env, {
        to: env.CONSULTING_ALERT_EMAIL, replyTo: reqRow.email,
        ...consultingRequestAlertEmail(env, { ...reqRow, member: !!sub, profileSummary: profileSummary(prof) }),
      }));
    }
    ctx.waitUntil(Promise.all(tasks).catch(() => {}));
    return html(P.messagePage(env, {
      title: 'Request received',
      message: "Thanks. We'll reply by email with pricing and a few times that work.",
      cta: sess ? { href: '/portal', label: 'Back to portal' } : { href: '/', label: 'Home' },
    }));
  }
  if (method === 'GET' && pathname === '/consulting/booked') {
    return html(P.messagePage(env, {
      title: 'Your session is confirmed',
      message: "Payment received. We've emailed you a link to pick your time.",
      cta: env.BOOKING_URL ? { href: env.BOOKING_URL, label: 'Pick a time now' } : { href: '/portal', label: 'Back to portal' },
    }));
  }

  // Free sample: the wow, once per person, with a daily cap to bound model spend
  if (method === 'POST' && pathname === '/api/sample') {
    const f = await readForm(request);
    if (!isEmail(f.email) || !f.role || !f.goals) return html(P.messagePage(env, { title: 'Almost', message: 'Please fill in your email, role and goals.', cta: { href: '/#sample', label: 'Back' } }), 400);
    const cap = parseInt(env.SAMPLE_DAILY_CAP || '50', 10);
    const today = await first(db, "SELECT COUNT(*) AS n FROM samples WHERE created_at >= date('now')");
    const prior = await first(db, 'SELECT email FROM samples WHERE email = ?', f.email.toLowerCase().trim());
    if (!prior && today && today.n >= cap) {
      return html(P.messagePage(env, { title: 'Samples are full today', message: "We've hit today's limit for free samples. Subscribe to get your first drop right away, or try again tomorrow.", cta: { href: '/#pricing', label: 'See plans' } }));
    }
    const result = await sampleDrop(env, db, { email: f.email, profile: pickProfile(f) });
    return html(P.samplePage(env, result));
  }

  // Post-checkout intake
  if (method === 'GET' && pathname === '/welcome') {
    const sid = url.searchParams.get('session_id');
    if (!sid) return redirect('/#pricing');
    const s = await getCheckoutSession(env, sid).catch(() => null);
    return html(P.intakePage(env, { email: s?.customer_details?.email || '', plan: s?.metadata?.plan, sessionId: sid }));
  }
  if (method === 'POST' && pathname === '/api/intake') {
    const f = await readForm(request);
    const s = f.session_id ? await getCheckoutSession(env, f.session_id).catch(() => null) : null;
    const paid = s && (s.status === 'complete' || s.payment_status === 'paid' || env.STRIPE_MOCK === '1');
    if (!paid || s.metadata?.product === 'consulting') {
      return html(P.intakePage(env, { email: f.email, sessionId: f.session_id, error: "We couldn't confirm your checkout. Use the link in your welcome email, or contact support." }), 400);
    }
    const email = s.customer_details?.email && env.STRIPE_MOCK !== '1' ? s.customer_details.email : f.email;
    if (!isEmail(email)) return html(P.intakePage(env, { email: f.email, sessionId: f.session_id, error: 'Please enter a valid email.' }), 400);
    const sub = await upsertSubscriber(db, {
      email, name: f.name,
      // Only set the plan when the session states it — never downgrade a plan the webhook already set.
      plan: 'core',
      customer: s.customer, subscription: s.subscription, status: 'active',
    });
    await setCommitment(db, env, sub, s.created);
    let profiles = await getProfiles(db, sub.id);
    let profileId = profiles[0]?.id;
    if (!profileId) {
      profileId = uuid();
      const p = pickProfile(f);
      await run(db, 'INSERT INTO profiles (id, subscriber_id, label, role, industry, tools, goals, ai_level, vertical) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        profileId, sub.id, 'Primary', p.role, p.industry, p.tools, p.goals, p.ai_level, p.vertical);
      ctx.waitUntil(welcomeDrop(env, db, profileId).catch((e) => alertOps(env, 'Welcome drop failed', e.message)));
    }
    const token = await signToken(env.SESSION_SECRET, sub.id);
    return new Response(null, { status: 303, headers: { location: '/portal?welcome=1', 'set-cookie': cookieHeader(token) } });
  }

  // Magic-link sign-in
  if (method === 'POST' && pathname === '/api/login') {
    const f = await readForm(request);
    if (isEmail(f.email)) {
      const sub = await getSubscriberByEmail(db, f.email);
      if (sub) {
        const token = await signToken(env.SESSION_SECRET, sub.id);
        const link = `${env.APP_URL}/auth?t=${encodeURIComponent(token)}`;
        ctx.waitUntil(sendEmail(env, { to: sub.email, ...magicLinkEmail(env, { link }) }).catch(() => {}));
      }
    }
    return html(P.loginPage(env, { sent: true })); // same response either way (no account probing)
  }
  if (method === 'GET' && pathname === '/auth') {
    const sid = await verifyToken(env.SESSION_SECRET, url.searchParams.get('t'));
    if (!sid) return html(P.messagePage(env, { title: 'Link expired', message: 'Request a fresh sign-in link.', cta: { href: '/login', label: 'Get a new link' } }), 401);
    return new Response(null, { status: 303, headers: { location: '/portal', 'set-cookie': cookieHeader(url.searchParams.get('t')) } });
  }
  if (method === 'GET' && pathname === '/logout') {
    return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
  }

  // Subscriber-only
  const sess = await session(request, env, url);
  const setCookie = sess?.fromQuery ? { 'set-cookie': cookieHeader(sess.token) } : {};

  if (method === 'GET' && pathname === '/portal') {
    if (!sess) return redirect('/login');
    const profiles = await getProfiles(db, sess.sub.id);
    const drops = await all(db, 'SELECT id, subject, week_id, kind, created_at FROM drops WHERE subscriber_id = ? ORDER BY created_at DESC LIMIT 60', sess.sub.id);
    let videos = [];
    try { videos = JSON.parse(env.MUSE_VIDEOS || '[]'); } catch { videos = []; }
    const flash = url.searchParams.get('welcome') ? "You're all set. Your starter package is being written and will land in your inbox in a few minutes."
      : url.searchParams.get('saved') ? 'Saved. Next week\'s drop will use your updated profile.' : '';
    return html(P.portalPage(env, {
      sub: sess.sub, profiles, drops, flash, videos,
      canAddProfile: profiles.length < profileLimit(sess.sub.plan),
    }), 200, setCookie);
  }
  if (method === 'GET' && pathname.startsWith('/drop/')) {
    if (!sess) return redirect('/login');
    const drop = await first(db, 'SELECT * FROM drops WHERE id = ? AND subscriber_id = ?', pathname.split('/')[2], sess.sub.id);
    if (!drop) return html(P.messagePage(env, { title: 'Not found', message: "That drop isn't on your account.", cta: { href: '/portal', label: 'Portal' } }), 404);
    return html(P.dropPage(env, { drop }), 200, setCookie);
  }
  if (method === 'POST' && pathname === '/api/profile') {
    if (!sess) return redirect('/login');
    const f = await readForm(request);
    const p = pickProfile(f);
    if (f.profile_id) {
      await run(db, 'UPDATE profiles SET role=?, industry=?, tools=?, goals=?, ai_level=?, vertical=? WHERE id = ? AND subscriber_id = ?',
        p.role, p.industry, p.tools, p.goals, p.ai_level, p.vertical, f.profile_id, sess.sub.id);
    } else {
      const existing = await getProfiles(db, sess.sub.id);
      if (existing.length < profileLimit(sess.sub.plan)) {
        await run(db, 'INSERT INTO profiles (id, subscriber_id, label, role, industry, tools, goals, ai_level, vertical) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          uuid(), sess.sub.id, String(f.label || 'Second profile').slice(0, 60), p.role, p.industry, p.tools, p.goals, p.ai_level, p.vertical);
      }
    }
    return redirect('/portal?saved=1');
  }
  if (method === 'POST' && pathname === '/api/portal/cancel') {
    if (!sess) return redirect('/login');
    if (!sess.sub.stripe_sub_id) return redirect('/portal');
    const months = commitmentMonths(env);
    const ends = sess.sub.commitment_ends_at ? new Date(sess.sub.commitment_ends_at) : null;
    const inTerm = !!ends && ends.getTime() > Date.now();
    const res = await scheduleCancel(env, sess.sub.stripe_sub_id, inTerm ? Math.floor(ends.getTime() / 1000) : null);
    const periodEnd = res.items?.data?.[0]?.current_period_end ?? res.current_period_end;
    const cancelsAt = inTerm ? ends.toISOString() : periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
    await run(db, "UPDATE subscribers SET cancels_at = ?, updated_at = datetime('now') WHERE id = ?", cancelsAt, sess.sub.id);
    return html(P.messagePage(env, {
      title: 'Cancellation scheduled',
      message: inTerm
        ? `Your membership has a ${months}-month minimum, so it ends on ${fmtDate(cancelsAt)}. You keep full access until then and won't be charged after that.`
        : `Your membership ends${cancelsAt ? ` on ${fmtDate(cancelsAt)}` : ' at the close of this billing period'}. You keep full access until then, and you won't be charged again.`,
      cta: { href: '/portal', label: 'Back to portal' },
    }), 200, setCookie);
  }
  if (method === 'POST' && pathname === '/api/portal/billing') {
    if (!sess) return redirect('/login');
    if (!sess.sub.stripe_customer_id) return redirect('/portal');
    const portal = await createBillingPortal(env, sess.sub.stripe_customer_id);
    return redirect(portal.url);
  }

  return html(P.messagePage(env, { title: 'Not found', message: "That page doesn't exist.", cta: { href: '/', label: 'Home' } }), 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (e) {
      ctx.waitUntil(alertOps(env, 'Request error', `${request.method} ${new URL(request.url).pathname}: ${e.stack || e.message}`));
      return html(P.messagePage(env, { title: 'Something went wrong', message: 'Please try again in a moment.' }), 500);
    }
  },

  // Weekly cron (see wrangler.toml [triggers]).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(weeklyRun(env, env.DB).catch((e) => alertOps(env, 'Weekly run failed', e.stack || e.message)));
  },

  // Queue consumer: one personalized drop per message, retried automatically on failure.
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await processDrop(env, env.DB, msg.body);
        msg.ack();
      } catch (e) {
        if (msg.attempts >= 3) {
          await alertOps(env, 'Drop failed after retries', `${JSON.stringify(msg.body)}: ${e.message}`);
          msg.ack();
        } else {
          msg.retry({ delaySeconds: 60 * msg.attempts });
        }
      }
    }
  },

  // Inbound email capture (Cloudflare Email Routing -> this Worker).
  async email(message, env) {
    await captureFromEmail(env, env.DB, message);
  },
};

export { handleFetch, handleStripeWebhook };
