#!/usr/bin/env node
// One-time Stripe setup for Phase 2 Labs LLC's account — the Co-Pilot rate card:
//
//   Co-Pilot membership   $50/month, cancel anytime, no refunds, starter package included
//   1:1 session           $500/hour, billed privately (the website says "Request pricing")
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs https://coach.co-pilot.ai
//
// It creates (or reuses) the two products and prices, retires older prices (the $100 Pro plan and
// the $1,250 hourly rate), creates a Customer Portal configuration with cancel turned OFF (so the
// app's own cancel button handles it, at the end of the paid month), a private payment link for 1:1 time, and
// the webhook. Safe to re-run: everything is matched by metadata.copilots_key.

const key = process.env.STRIPE_SECRET_KEY;
const appUrl = (process.argv[2] || '').replace(/\/$/, '');
if (!key || !appUrl) {
  console.error('Usage: STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe.mjs https://your-app-url');
  process.exit(1);
}
const member = Number(process.env.CORE_PRICE || 50);
const months = Number(process.env.COMMITMENT_MONTHS || 0);
const rate = Number(process.env.CONSULTING_RATE || 500);

function enc(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const kk = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? enc(x, `${kk}[${i}]`, out) : out.append(`${kk}[${i}]`, String(x))));
    else if (v && typeof v === 'object') enc(v, kk, out);
    else if (v !== undefined) out.append(kk, String(v));
  }
  return out;
}
async function api(method, path, params) {
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && params ? '?' + enc(params) : ''}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : enc(params || {}).toString(),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(`${path}: ${d.error?.message}`);
  return d;
}

async function findProduct(copilotsKey) {
  const found = await api('GET', '/products/search', { query: `metadata['copilots_key']:'${copilotsKey}'` });
  return found.data?.[0] || null;
}

// One product, exactly one active price matching the spec; any other active price is archived.
async function ensureProduct(copilotsKey, name, description, priceSpec) {
  let product = await findProduct(copilotsKey);
  if (!product) product = await api('POST', '/products', { name, description, metadata: { copilots_key: copilotsKey } });
  else await api('POST', `/products/${product.id}`, { name, description, active: 'true' });
  const prices = await api('GET', '/prices', { product: product.id, active: 'true', limit: 100 });
  const matches = (p) => p.unit_amount === priceSpec.unit_amount && (!!p.recurring) === (!!priceSpec.recurring)
    && (!priceSpec.recurring || p.recurring.interval === priceSpec.recurring.interval);
  let price = prices.data.find(matches);
  if (!price) price = await api('POST', '/prices', { product: product.id, currency: 'usd', ...priceSpec });
  for (const p of prices.data) {
    if (p.id !== price.id) { await api('POST', `/prices/${p.id}`, { active: 'false' }); console.log(`  archived old price ${p.id} ($${p.unit_amount / 100})`); }
  }
  return { product, price };
}

// The $100 Pro plan is gone from the rate card: archive it (existing subscribers, if any, keep billing
// until moved; archived prices cannot be bought).
async function retire(copilotsKey) {
  const product = await findProduct(copilotsKey);
  if (!product) return;
  const prices = await api('GET', '/prices', { product: product.id, active: 'true', limit: 100 });
  for (const p of prices.data) await api('POST', `/prices/${p.id}`, { active: 'false' });
  await api('POST', `/products/${product.id}`, { active: 'false' });
  console.log(`  retired ${product.name}`);
}

console.log('Setting up the Co-Pilot rate card…');

const core = await ensureProduct('coaching_core', 'Co-Pilot membership (monthly)',
  `Weekly personalized AI briefing plus the starter package. ${months ? `${months}-month minimum, then month to month` : 'Month to month, cancel anytime, non-refundable'}. Operated by Phase 2 Labs LLC.`,
  { unit_amount: member * 100, recurring: { interval: 'month' } });

const consulting = await ensureProduct('consulting_hour', '1:1 session (per hour)',
  '1:1 AI working session with a Co-Pilot practitioner, billed per hour. Phase 2 Labs LLC.',
  { unit_amount: rate * 100 });

await retire('coaching_pro');

// Customer Portal: cards, receipts and contact details only. Cancel is handled by the app.
const configs = await api('GET', '/billing_portal/configurations', { limit: 100 });
let portal = configs.data.find((c) => c.metadata?.copilots_key === 'portal' && c.active);
const portalSpec = {
  business_profile: { headline: 'Co-Pilot membership: update your card or download receipts.' },
  default_return_url: `${appUrl}/portal`,
  features: {
    payment_method_update: { enabled: 'true' },
    invoice_history: { enabled: 'true' },
    customer_update: { enabled: 'true', allowed_updates: ['email', 'address'] },
    subscription_cancel: { enabled: 'false' },
    subscription_update: { enabled: 'false' },
  },
  metadata: { copilots_key: 'portal' },
};
portal = portal
  ? await api('POST', `/billing_portal/configurations/${portal.id}`, portalSpec)
  : await api('POST', '/billing_portal/configurations', portalSpec);

// Private payment link for quoted 1:1 time (adjustable hours). Share it only after quoting.
const links = await api('GET', '/payment_links', { active: 'true', limit: 100 });
let link = null;
for (const l of links.data.filter((x) => x.metadata?.copilots_key === 'consulting_link')) {
  const items = await api('GET', `/payment_links/${l.id}/line_items`, { limit: 1 });
  if (!link && items.data?.[0]?.price?.id === consulting.price.id) link = l;
  else await api('POST', `/payment_links/${l.id}`, { active: 'false' }); // points at an old price
}
if (!link) {
  link = await api('POST', '/payment_links', {
    line_items: [{ price: consulting.price.id, quantity: 1, adjustable_quantity: { enabled: 'true', minimum: 1, maximum: 10 } }],
    after_completion: { type: 'redirect', redirect: { url: `${appUrl}/consulting/booked` } },
    invoice_creation: { enabled: 'true' },
    metadata: { copilots_key: 'consulting_link', product: 'consulting' },
  });
}

// Webhook
const hookUrl = `${appUrl}/api/stripe/webhook`;
const hooks = await api('GET', '/webhook_endpoints', { limit: 100 });
let hook = hooks.data.find((h) => h.url === hookUrl);
const events = [
  'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.payment_failed', 'invoice.paid',
];
let secret = '(already exists — reuse its signing secret from the Stripe dashboard)';
if (!hook) {
  hook = await api('POST', '/webhook_endpoints', { url: hookUrl, enabled_events: events, description: 'Co-Pilot (Phase 2 Labs LLC)' });
  secret = hook.secret;
} else {
  await api('POST', `/webhook_endpoints/${hook.id}`, { enabled_events: events });
}

const out = [
  ['STRIPE_PRICE_CORE', core.price.id],
  ['STRIPE_PRICE_CONSULTING', consulting.price.id],
  ['STRIPE_PORTAL_CONFIG', portal.id],
  ['STRIPE_CONSULTING_LINK', link.id],
];
console.log('\nStripe is set up for Phase 2 Labs LLC.\n');
console.log(`  Membership: $${member}/month, ${months ? `${months}-month minimum` : 'cancel anytime'}  -> ${core.price.id}`);
console.log(`  1:1 session: $${rate}/hour (private)               -> ${consulting.price.id}`);
console.log(`  Private 1:1 payment link (share after quoting): ${link.url}\n`);
console.log('Store these as Worker secrets:\n');
for (const [k, v] of out) console.log(`  echo "${v}" | npx wrangler secret put ${k}`);
if (hook.secret) console.log(`  echo "${hook.secret}" | npx wrangler secret put STRIPE_WEBHOOK_SECRET`);
else console.log(`  STRIPE_WEBHOOK_SECRET ${secret}`);
console.log('\nBill 1:1 time after a session:  npm run bill:hours -- client@example.com 2 "Strategy session"');
