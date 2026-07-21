// Cloudflare Pages Function — Stripe webhook -> increments the reserved counter
// Route: /api/stripe-webhook  (POST, called by Stripe)
// Env needed:  STRIPE_WEBHOOK_SECRET (secret)  +  KV namespace bound as "VOTES"
//
// In Stripe: Developers -> Webhooks -> Add endpoint
//   URL:    https://co-pilot.ai/api/stripe-webhook
//   Events: checkout.session.completed  (also add payment_intent.succeeded if you
//           use Payment Links without Checkout Sessions)
//   Copy the "Signing secret" (whsec_...) into STRIPE_WEBHOOK_SECRET.

const COUNTED_EVENTS = ["checkout.session.completed", "payment_intent.succeeded"];

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = request.headers.get("stripe-signature");
  const body = await request.text(); // raw body required for signature check

  const ok = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("Invalid signature", { status: 400 });

  let event;
  try { event = JSON.parse(body); } catch (e) { return new Response("Bad JSON", { status: 400 }); }

  if (COUNTED_EVENTS.includes(event.type) && env.VOTES) {
    // idempotency: don't double-count the same Stripe event id
    const evId = event.id;
    const seen = evId ? await env.VOTES.get("evt:" + evId) : null;
    if (!seen) {
      const cur = parseInt((await env.VOTES.get("reserve:count")) || "0", 10) || 0;
      await env.VOTES.put("reserve:count", String(cur + 1));
      if (evId) await env.VOTES.put("evt:" + evId, "1", { expirationTtl: 60 * 60 * 24 * 30 });
    }
  }

  return Response.json({ received: true });
}

// Verifies Stripe's "stripe-signature" header (t=...,v1=...) with Web Crypto (no deps).
async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  header.split(",").forEach(function (kv) {
    const i = kv.indexOf("=");
    if (i > -1) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  // reject events older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(t, 10)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + payload));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");

  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
