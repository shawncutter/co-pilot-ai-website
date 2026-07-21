// Netlify Function — Stripe webhook -> increments the reserved counter
// Route: /api/stripe-webhook  (POST, called by Stripe)
// Requires a package.json with "stripe" installed, and env vars:
//   STRIPE_SECRET_KEY      (sk_live_... or sk_test_...)
//   STRIPE_WEBHOOK_SECRET  (whsec_... from the webhook endpoint)
//
// In Stripe: Developers -> Webhooks -> Add endpoint
//   URL:    https://co-pilot.ai/api/stripe-webhook
//   Events: checkout.session.completed  (+ payment_intent.succeeded if using Payment Links)

import Stripe from "stripe";
import { getStore } from "@netlify/blobs";

const COUNTED_EVENTS = ["checkout.session.completed", "payment_intent.succeeded"];

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  const body = await req.text(); // raw body required for signature check
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response("Invalid signature", { status: 400 });
  }

  if (COUNTED_EVENTS.includes(event.type)) {
    const store = getStore("reserve");
    // idempotency: skip if we've already counted this event id
    const seen = await store.get("evt:" + event.id);
    if (!seen) {
      const cur = parseInt((await store.get("count")) || "0", 10) || 0;
      await store.set("count", String(cur + 1));
      await store.set("evt:" + event.id, "1");
    }
  }

  return Response.json({ received: true });
};

export const config = { path: "/api/stripe-webhook" };
