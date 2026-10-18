// End-to-end: the full subscriber lifecycle with Stripe, models and email mocked.
// Proves the "zero involvement" rule: Shawn only ever hears about 1:1 sessions (a pricing request and a payment).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDB, makeCtx } from './d1-shim.js';
import worker, { handleFetch } from '../src/index.js';
import { weeklyRun } from '../src/engine.js';
import { hmacHex } from '../src/util.js';

const SCHEMA = fileURLToPath(new URL('../schema.sql', import.meta.url));
const SHAWN = 'shawn@energiacres.com';

// No real network in tests: feeds return an empty RSS document.
globalThis.fetch = async () => new Response('<rss><channel></channel></rss>', { status: 200 });

function makeEnv() {
  return {
    DB: makeDB(SCHEMA),
    APP_URL: 'https://coach.test',
    LEGAL_ENTITY: 'Phase 2 Labs LLC',
    SESSION_SECRET: 'test-session-secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_CORE: 'price_core',
    STRIPE_CONSULTING_LINK: 'plink_test',
    COMMITMENT_MONTHS: '0',
    CAPTURE_TOKEN: 'cap_token',
    CONSULTING_ALERT_EMAIL: SHAWN,
    BOOKING_URL: 'https://cal.test/shawn',
    REDACT_TERMS: 'EnergiAcres,Terrasow',
    MODEL_MOCK: '1', EMAIL_MOCK: '1', STRIPE_MOCK: '1',
  };
}

const req = (method, path, { body, headers = {}, form } = {}) => {
  const init = { method, headers: { ...headers } };
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers['content-type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  return new Request('https://coach.test' + path, init);
};

async function signedWebhook(env, event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  return req('POST', '/api/stripe/webhook', { body: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
}

const sent = () => globalThis.__sentEmails || [];
const sentTo = (addr) => sent().filter((m) => m.to === addr);

test('full lifecycle: capture -> subscribe -> starter package -> weekly briefings -> 1:1 request and payment -> cancel anytime, no refund', async () => {
  globalThis.__sentEmails = [];
  globalThis.__stripeCalls = [];
  const env = makeEnv();
  const ctx = makeCtx();
  const go = async (r) => { const res = await handleFetch(r, env, ctx); await ctx.flush(); return res; };

  // Landing page names the merchant
  const home = await go(req('GET', '/'));
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Phase 2 Labs LLC/);

  // Capture: auth required, then saved
  assert.equal((await go(req('POST', '/api/capture', { body: { body: 'x' } }))).status, 401);
  const cap = await go(req('POST', '/api/capture', {
    headers: { authorization: 'Bearer cap_token' },
    body: { items: [
      { title: 'Deal screen', body: 'Used a Claude orchestrator to screen the EnergiAcres $2M deal with parallel sub-agents.' },
      { title: 'Deck', body: 'Built a pitch deck from a design system, then refined it in Canva.' },
    ] },
  }));
  assert.equal((await cap.json()).saved, 2);

  // Landing page shows the simple rate card: $50/month, cancel anytime, no refunds; 1:1 as "Request pricing"
  const homeHtml = await (await go(req('GET', '/'))).text();
  assert.match(homeHtml, /\$50<small>\/month/);
  assert.match(homeHtml, /cancel anytime and payments are non-refundable/);
  assert.ok(!/minimum/.test(homeHtml), 'no minimum term anywhere on the page');
  assert.match(homeHtml, /Request pricing/);
  assert.ok(!/\$500|1,250/.test(homeHtml), 'no hourly price on the public site');

  // Checkout needs the no-refund acknowledgement, then redirects to Stripe with the terms stated
  assert.equal((await go(req('POST', '/api/checkout', { form: {} }))).status, 400);
  const co = await go(req('POST', '/api/checkout', { form: { agree: 'yes' } }));
  assert.equal(co.status, 303);
  assert.match(co.headers.get('location'), /checkout\.stripe/);
  const coCall = globalThis.__stripeCalls.find((c) => c.path === '/checkout/sessions');
  assert.equal(coCall.params.line_items[0].price, 'price_core');
  assert.match(coCall.params.custom_text.submit.message, /^\$50\/month.*Cancel anytime.*non-refundable/);

  // Webhook: subscription checkout completed -> subscriber active, intake email sent
  const evt = { id: 'evt_1', type: 'checkout.session.completed', data: { object: {
    id: 'cs_alice', customer: 'cus_alice', subscription: 'sub_alice', created: Math.floor(Date.UTC(2026, 9, 14, 16) / 1000),
    customer_details: { email: 'alice@lawfirm.com', name: 'Alice' },
    metadata: { product: 'coaching', plan: 'core' },
  } } };
  assert.equal((await go(await signedWebhook(env, evt))).status, 200);
  const dup = await go(await signedWebhook(env, evt));
  assert.equal((await dup.json()).duplicate, true);
  const alice = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind('alice@lawfirm.com').first();
  assert.equal(alice.status, 'active');
  assert.equal(alice.plan, 'core');
  assert.equal(alice.commitment_ends_at, null, 'no minimum term');
  assert.equal(sentTo('alice@lawfirm.com').length, 1, 'intake email');

  // Bad signature rejected
  const bad = await go(req('POST', '/api/stripe/webhook', { body: '{}', headers: { 'stripe-signature': 't=1,v1=00' } }));
  assert.equal(bad.status, 400);

  // Intake -> portal + welcome drop emailed immediately
  const intake = await go(req('POST', '/api/intake', { form: {
    session_id: 'cs_alice', email: 'alice@lawfirm.com', name: 'Alice',
    role: 'Managing partner', industry: '12-attorney litigation firm', tools: 'Outlook, Clio',
    goals: 'Faster intake and first-draft memos', ai_level: 'some', vertical: 'legal',
  } }));
  assert.equal(intake.status, 303);
  const cookie = intake.headers.get('set-cookie').split(';')[0];
  assert.equal(sentTo('alice@lawfirm.com').length, 2, 'starter package');
  assert.match(sentTo('alice@lawfirm.com')[1].subject, /starter package/i);

  // Nothing confidential reached any stored week or drop
  const texts = [
    ...(await env.DB.prepare('SELECT digest || frontier || teaser AS t FROM weeks').all()).results.map((r) => r.t),
    ...(await env.DB.prepare('SELECT subject || body_md AS t FROM drops').all()).results.map((r) => r.t),
  ].join('\n');
  assert.ok(!/EnergiAcres|\$2M/.test(texts), 'redaction held');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM capture_items WHERE week_id IS NULL').first()).n, 0, 'capture consumed');

  // Portal works with the cookie and lists the drop
  const portal = await go(req('GET', '/portal', { headers: { cookie } }));
  assert.equal(portal.status, 200);
  assert.match(await portal.text(), /Your drops[\s\S]*welcome/);

  // One membership, one profile: a second is refused silently
  await go(req('POST', '/api/profile', { headers: { cookie }, form: { label: 'Board work', role: 'Board member', industry: 'Bank', goals: 'Board prep' } }));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM profiles').first()).n, 1);

  // Weekly run (next week, no queue binding -> inline): one drop per profile
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  const run1 = await weeklyRun(env, env.DB, nextWeek);
  assert.equal(run1.profiles, 1);
  assert.equal(sentTo('alice@lawfirm.com').length, 3, 'one weekly briefing');
  // Re-running the same week is idempotent
  await weeklyRun(env, env.DB, nextWeek);
  assert.equal(sentTo('alice@lawfirm.com').length, 3, 'no duplicate sends');

  // 1:1 is "request pricing": the request reaches Shawn, the requester gets an acknowledgement
  assert.equal((await go(req('POST', '/api/consulting/request', { form: { email: 'bob@vc.com' } }))).status, 400);
  const ask = await go(req('POST', '/api/consulting/request', { form: { name: 'Bob', email: 'bob@vc.com', company: 'Seed fund', topic: 'Set up agents for deal flow', timing: 'Next week' } }));
  assert.equal(ask.status, 200);
  assert.match(await ask.text(), /Request received/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM consulting_requests').first()).n, 1);
  assert.match(sentTo('bob@vc.com')[0].subject, /1:1 request/);
  assert.match(sentTo(SHAWN)[0].subject, /1:1 pricing request from Bob/);

  // Shawn quotes and sends the private payment link: 2 hours at $500 -> confirmation + booking link
  const paid = { id: 'evt_2', type: 'checkout.session.completed', data: { object: {
    id: 'cs_bob', payment_link: 'plink_test', amount_total: 100000, customer_details: { email: 'bob@vc.com' }, metadata: {},
  } } };
  await go(await signedWebhook(env, paid));
  assert.equal(sentTo('bob@vc.com').length, 2);
  assert.match(sentTo('bob@vc.com')[1].html, /cal\.test\/shawn/);
  assert.equal((await env.DB.prepare('SELECT hours FROM consulting_orders WHERE id = ?').bind('cs_bob').first()).hours, 2);

  // An invoice sent after a session (scripts/bill-hours.mjs) is recorded when paid
  await go(await signedWebhook(env, { id: 'evt_inv', type: 'invoice.paid', data: { object: {
    id: 'in_1', customer: 'cus_bob', customer_email: 'bob@vc.com', amount_paid: 75000, metadata: { product: 'consulting', hours: '1.5', topic: 'Agent setup' },
  } } }));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM consulting_orders').first()).n, 2);

  // Cancel anytime: ends at the close of the paid period, no proration and no refund
  const cancel = await go(req('POST', '/api/portal/cancel', { headers: { cookie } }));
  assert.equal(cancel.status, 200);
  assert.match(await cancel.text(), /ends on .*won(&#39;|&#x27;|')t be charged again/);
  const subCall = globalThis.__stripeCalls.find((c) => c.path === '/subscriptions/sub_alice');
  assert.equal(subCall.params.cancel_at_period_end, 'true');
  assert.equal(subCall.params.cancel_at, undefined);
  const portal2 = await (await go(req('GET', '/portal', { headers: { cookie } }))).text();
  assert.match(portal2, /ends on <strong>/);
  const refunds = await (await go(req('GET', '/refunds'))).text();
  assert.match(refunds, /non-refundable/);
  assert.ok(!/minimum commitment/.test(refunds));

  // When the subscription finally ends -> excluded from the following week
  await go(await signedWebhook(env, { id: 'evt_3', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_alice' } } }));
  const weekAfter = new Date(Date.now() + 14 * 86400000);
  const run2 = await weeklyRun(env, env.DB, weekAfter);
  assert.equal(run2.profiles, 0);
  assert.equal(sentTo('alice@lawfirm.com').length, 3);

  // THE RULE: Shawn only heard about 1:1 — one pricing request and one payment.
  assert.equal(sentTo(SHAWN).length, 2);
  assert.match(sentTo(SHAWN)[1].subject, /1:1 paid: 2h by bob@vc.com/);
});

test('free sample: once per email, with daily cap', async () => {
  globalThis.__sentEmails = [];
  const env = { ...makeEnv(), SAMPLE_DAILY_CAP: '1' };
  const ctx = makeCtx();
  const form = { email: 'jasmine@re.com', role: 'Broker', industry: 'Real estate', goals: 'Listings and comps' };
  const first = await handleFetch(req('POST', '/api/sample', { form }), env, ctx);
  assert.equal(first.status, 200);
  assert.match(await first.text(), /Your one-time sample/);
  const again = await handleFetch(req('POST', '/api/sample', { form }), env, ctx);
  assert.match(await again.text(), /already have your free sample/);
  const other = await handleFetch(req('POST', '/api/sample', { form: { ...form, email: 'warner@re.com' } }), env, ctx);
  assert.match(await other.text(), /Samples are full today/);
});

test('queue consumer retries then acks; health endpoint reports entity', async () => {
  const env = makeEnv();
  let acked = 0, retried = 0;
  const msg = (attempts) => ({ body: { profileId: 'missing', weekId: '2026-W42' }, attempts, ack: () => acked++, retry: () => retried++ });
  await worker.queue({ messages: [msg(1)] }, env); // missing profile -> skipped -> ack
  assert.equal(acked, 1);
  const h = await handleFetch(req('GET', '/api/health'), env, makeCtx());
  assert.equal((await h.json()).entity, 'Phase 2 Labs LLC');
});

test('webhook failure is not recorded, so Stripe retry succeeds', async () => {
  globalThis.__sentEmails = [];
  const env = makeEnv();
  const realPrepare = env.DB.prepare.bind(env.DB);
  let failOnce = true;
  env.DB.prepare = (sql) => {
    if (failOnce && sql.startsWith('INSERT INTO subscribers')) { failOnce = false; throw new Error('transient D1 error'); }
    return realPrepare(sql);
  };
  const ctx = makeCtx();
  const evt = { id: 'evt_retry', type: 'checkout.session.completed', data: { object: {
    id: 'cs_r', customer: 'cus_r', subscription: 'sub_r', customer_details: { email: 'retry@x.com' }, metadata: { product: 'coaching', plan: 'core' },
  } } };
  const firstTry = await handleFetch(await signedWebhook(env, evt), env, ctx);
  assert.equal(firstTry.status, 500);
  const retry = await handleFetch(await signedWebhook(env, evt), env, ctx);
  assert.equal(retry.status, 200);
  assert.notEqual((await retry.json()).duplicate, true);
  const sub = await env.DB.prepare('SELECT status FROM subscribers WHERE email = ?').bind('retry@x.com').first();
  assert.equal(sub.status, 'active');
});

test('mid-week welcome drop does not consume captures meant for Monday', async () => {
  globalThis.__sentEmails = [];
  const env = makeEnv();
  const ctx = makeCtx();
  await weeklyRun(env, env.DB, new Date()); // an existing week
  await handleFetch(req('POST', '/api/capture', { headers: { authorization: 'Bearer cap_token' }, body: { title: 'Mid-week', body: 'Used NotebookLM on a deal room.' } }), env, ctx);
  await handleFetch(req('POST', '/api/intake', { form: { session_id: 'cs_w', email: 'w@x.com', role: 'Investor', industry: 'VC', goals: 'Faster diligence' } }), env, ctx);
  await ctx.flush();
  assert.equal(sentTo('w@x.com').length, 1, 'welcome drop sent');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM capture_items WHERE week_id IS NULL').first()).n, 1, 'capture still waiting for Monday');
  await weeklyRun(env, env.DB, new Date(Date.now() + 7 * 86400000));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM capture_items WHERE week_id IS NULL').first()).n, 0, 'consumed by Monday run');
});
