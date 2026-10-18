#!/usr/bin/env node
// Bill 1:1 time after a session: creates a Stripe invoice at the hourly rate and emails it to the client.
//
//   STRIPE_SECRET_KEY=sk_... npm run bill:hours -- client@example.com 2 "Strategy session, Oct 14"
//   STRIPE_SECRET_KEY=sk_... npm run bill:hours -- client@example.com 1.5 "Agent setup" --name "Dana Lee" --due 14
//   add --dry-run to see what would be billed without touching Stripe.
//
// Hours can be fractional in quarter-hour steps; the amount is hours x rate.
// The invoice carries metadata.product = consulting, so the app records it when it is paid.

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const dryRun = args.includes('--dry-run'); if (dryRun) args.splice(args.indexOf('--dry-run'), 1);
const name = flag('--name');
const due = Number(flag('--due') || 7);
const [email, hoursArg, ...rest] = args;
const description = rest.join(' ') || '1:1 session';
const hours = Number(hoursArg);
const rate = Number(process.env.CONSULTING_RATE || 500);
const key = process.env.STRIPE_SECRET_KEY;

if (!email || !email.includes('@') || !(hours > 0) || Math.round(hours * 4) !== hours * 4) {
  console.error('Usage: STRIPE_SECRET_KEY=sk_... npm run bill:hours -- <email> <hours, in 0.25 steps> ["description"] [--name "Full Name"] [--due 7] [--dry-run]');
  process.exit(1);
}
const totalCents = Math.round(hours * rate * 100);
console.log(`${dryRun ? '[dry run] ' : ''}Billing ${email}: ${hours} h x $${rate} = $${(totalCents / 100).toFixed(2)}, due in ${due} days — "${description}"`);
if (dryRun) process.exit(0);
if (!key) { console.error('Set STRIPE_SECRET_KEY.'); process.exit(1); }

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

// Customer: reuse by email, else create.
const existing = await api('GET', '/customers', { email, limit: 1 });
const customer = existing.data?.[0] || await api('POST', '/customers', { email, name });

// The billable line: hours x rate, as one invoice item.
await api('POST', '/invoiceitems', {
  customer: customer.id, amount: totalCents, currency: 'usd',
  description: `${description} — ${hours} h at $${rate}/h`,
});
const invoice = await api('POST', '/invoices', {
  customer: customer.id,
  collection_method: 'send_invoice',
  days_until_due: due,
  pending_invoice_items_behavior: 'include',
  description: '1:1 session with Co-Pilot. Thank you.',
  metadata: { product: 'consulting', hours: String(hours), topic: description.slice(0, 450) },
});
const finalized = await api('POST', `/invoices/${invoice.id}/finalize`, {});
await api('POST', `/invoices/${invoice.id}/send`, {});
console.log(`Sent invoice ${finalized.number || finalized.id} for $${(finalized.amount_due / 100).toFixed(2)}.`);
console.log(`Client pays here: ${finalized.hosted_invoice_url}`);
