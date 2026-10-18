// Minimal Stripe client over fetch (no SDK needed in Workers).
// All money flows to the Stripe account owned by Phase 2 Labs LLC.
//
// Rate card:
//   Co-Pilot membership — $50/month, cancel anytime, no refunds, starter package included.
//   (COMMITMENT_MONTHS can add a minimum term later; 0 = none, the default.)
//   1:1 sessions        — $500/hour, billed privately (request pricing on the website).
import { hmacHex, safeEqual } from './util.js';

// Encode nested objects/arrays the way Stripe's form API expects:
// { line_items: [{ price: 'p', quantity: 1 }] } -> line_items[0][price]=p&line_items[0][quantity]=1
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      formEncode(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

export async function stripeRequest(env, method, path, params) {
  if (env.STRIPE_MOCK === '1') return mockStripe(method, path, params);
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : formEncode(params || {}).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path} failed: ${data?.error?.message || res.status}`);
  return data;
}

// ---- The commitment ----
export const commitmentMonths = (env) => Math.max(parseInt(env.COMMITMENT_MONTHS ?? '0', 10) || 0, 0);
export const memberPrice = (env) => Number(env.CORE_PRICE || 50);

export function commitmentText(env) {
  const m = commitmentMonths(env), p = memberPrice(env);
  if (!m) return `$${p}/month, starter package included. Cancel anytime: cancelling stops your next charge and you keep access until the end of the month you've paid for. Payments are non-refundable.`;
  return `${m}-month minimum: $${p}/month for your first ${m} months ($${p * m} total), starter package included. ` +
    `After month ${m} it's month to month and you can cancel anytime.`;
}

// Add whole calendar months in UTC, clamping to the last day of a shorter month
// (Jan 31 + 1 month = Feb 28/29), the same way Stripe advances a monthly billing date.
export function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

// Membership checkout: one monthly price, with the cancel and refund terms stated on the Stripe page itself.
export function createSubscriptionCheckout(env, { email, referral }) {
  return stripeRequest(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price: env.STRIPE_PRICE_CORE, quantity: 1 }],
    customer_email: email || undefined,
    allow_promotion_codes: 'true', // partner referral codes (Ed, Jornell…)
    custom_text: { submit: { message: commitmentText(env) } },
    success_url: `${env.APP_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/#pricing`,
    metadata: { product: 'coaching', plan: 'core', commitment_months: String(commitmentMonths(env)), referral: referral || '' },
    subscription_data: { metadata: { product: 'coaching', plan: 'core', commitment_months: String(commitmentMonths(env)) } },
  });
}

// Stripe's portal is limited to cards and receipts (cancel is turned off in the portal
// configuration created by scripts/setup-stripe.mjs) so cancellations go through
// /api/portal/cancel, which honors the minimum term.
export function createBillingPortal(env, customerId) {
  return stripeRequest(env, 'POST', '/billing_portal/sessions', {
    customer: customerId,
    configuration: env.STRIPE_PORTAL_CONFIG || undefined,
    return_url: `${env.APP_URL}/portal`,
  });
}

// Cancel a membership. Inside the minimum term it ends exactly when the term ends
// (no proration, no early-exit refund); after the term it ends with the current period.
export function scheduleCancel(env, subscriptionId, cancelAtUnix) {
  const params = cancelAtUnix
    ? { cancel_at: cancelAtUnix, proration_behavior: 'none' }
    : { cancel_at_period_end: 'true' };
  return stripeRequest(env, 'POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, params);
}

export function getCheckoutSession(env, id) {
  return stripeRequest(env, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);
}

// Verify Stripe's "stripe-signature" header (t=…,v1=…) with Web Crypto.
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = {};
  for (const kv of header.split(',')) {
    const i = kv.indexOf('=');
    if (i > -1) {
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (k === 'v1') (parts.v1 ||= []).push(v);
      else parts[k] = v;
    }
  }
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parseInt(parts.t, 10)) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${parts.t}.${payload}`);
  return parts.v1.some((sig) => safeEqual(sig, expected));
}

// Deterministic stand-in so the whole system can be exercised without Stripe keys.
function mockStripe(method, path, params = {}) {
  (globalThis.__stripeCalls ||= []).push({ method, path, params });
  if (path === '/checkout/sessions') return { id: 'cs_mock_' + crypto.randomUUID().slice(0, 8), url: 'https://checkout.stripe.test/session' };
  if (path === '/billing_portal/sessions') return { url: 'https://billing.stripe.test/portal' };
  if (path.startsWith('/checkout/sessions/')) return { id: path.split('/').pop(), customer_details: { email: 'mock@example.com' }, metadata: {} };
  if (path.startsWith('/subscriptions/')) {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    return {
      id: path.split('/').pop(), cancel_at: params.cancel_at ?? null, cancel_at_period_end: params.cancel_at_period_end === 'true',
      items: { data: [{ current_period_end: periodEnd }] },
    };
  }
  return {};
}
