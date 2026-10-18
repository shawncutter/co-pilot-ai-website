import test from 'node:test';
import assert from 'node:assert/strict';
import { weekId, mdToHtml, hmacHex } from '../src/util.js';
import { signToken, verifyToken } from '../src/auth.js';
import { verifyStripeSignature, formEncode } from '../src/stripe.js';
import { ruleRedact } from '../src/redact.js';
import { parseFeed } from '../src/capture.js';
import { splitSubject } from '../src/prompts.js';
import { runTask } from '../src/models.js';

test('weekId is ISO week', () => {
  assert.equal(weekId(new Date('2026-10-12T12:00:00Z')), '2026-W42');
  assert.equal(weekId(new Date('2026-01-01T00:00:00Z')), '2026-W01');
});

test('mdToHtml escapes HTML and renders structure', () => {
  const out = mdToHtml('## Hi\n- **bold** <script>x</script>\n```\ncode <b>\n```\n[link](https://x.com)');
  assert.match(out, /<h3>Hi<\/h3>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;b&gt;/);
  assert.match(out, /<a href="https:\/\/x.com"/);
});

test('magic-link tokens: valid, tampered, expired', async () => {
  const t = await signToken('s3cret', 'sub-1');
  assert.equal(await verifyToken('s3cret', t), 'sub-1');
  assert.equal(await verifyToken('wrong', t), null);
  assert.equal(await verifyToken('s3cret', t.slice(0, -2) + 'aa'), null);
  const old = await signToken('s3cret', 'sub-1', -10);
  assert.equal(await verifyToken('s3cret', old), null);
});

test('stripe signature verification + replay window', async () => {
  const payload = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex('whsec_x', `${t}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_x'), true);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_y'), false);
  const oldT = t - 1000;
  const oldSig = await hmacHex('whsec_x', `${oldT}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${oldT},v1=${oldSig}`, 'whsec_x'), false);
});

test('formEncode nests like Stripe expects', () => {
  const s = formEncode({ line_items: [{ price: 'p_1', quantity: 2 }], metadata: { plan: 'pro' } }).toString();
  assert.equal(decodeURIComponent(s), 'line_items[0][price]=p_1&line_items[0][quantity]=2&metadata[plan]=pro');
});

test('rule redaction removes blocklisted names and PII', () => {
  const out = ruleRedact('Met Ed at EnergiAcres about a $4.5M deal, mail ed@firm.com or 813-555-1212', 'EnergiAcres');
  assert.ok(!/EnergiAcres/i.test(out));
  assert.ok(!out.includes('ed@firm.com'));
  assert.ok(!out.includes('813-555-1212'));
  assert.ok(!out.includes('$4.5M'));
});

test('parseFeed reads RSS and Atom, keeps last 7 days', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  const rss = `<rss><channel><item><title>New agent trick</title><link>https://a.com/1</link><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Old</title><link>https://a.com/0</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<feed><entry><title><![CDATA[Atom post]]></title><link href="https://b.com/2"/><updated>2026-10-10T00:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss, 7, now).map((i) => i.title), ['New agent trick']);
  assert.deepEqual(parseFeed(atom, 7, now).map((i) => i.url), ['https://b.com/2']);
});

test('splitSubject pulls the SUBJECT line', () => {
  const { subject, body } = splitSubject('SUBJECT: Agents for your intake\n## The one thing\nDo it');
  assert.equal(subject, 'Agents for your intake');
  assert.ok(body.startsWith('## The one thing'));
});

test('router falls through providers and reports failure clearly', async () => {
  await assert.rejects(runTask({}, 'adapt', { system: 's', prompt: 'p' }), /No providers configured/);
  const m = await runTask({ MODEL_MOCK: '1' }, 'qa', { system: 's', prompt: 'p' });
  assert.equal(m.provider, 'mock');
});

test('rate card: commitment text and month arithmetic', async () => {
  const { commitmentText, addMonths } = await import('../src/stripe.js');
  assert.match(commitmentText({}), /^\$50\/month, starter package included\. Cancel anytime: .*Payments are non-refundable\.$/);
  assert.match(commitmentText({ COMMITMENT_MONTHS: '4' }), /^4-month minimum: \$50\/month for your first 4 months \(\$200 total\)/);
  assert.equal(addMonths(new Date('2026-10-14T16:00:00Z'), 4).toISOString(), '2027-02-14T16:00:00.000Z');
  assert.equal(addMonths(new Date('2026-10-31T00:00:00Z'), 4).toISOString(), '2027-02-28T00:00:00.000Z');
});
