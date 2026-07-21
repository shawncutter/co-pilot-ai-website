// Cloudflare Pages Function — live reserved-deposit count
// Route: /api/reserved  (GET => { reserved: <number> })
// Reads the counter that /api/stripe-webhook increments. Uses KV bound as "VOTES".

export async function onRequest(context) {
  const kv = context.env.VOTES;
  let n = 0;
  if (kv) {
    n = parseInt((await kv.get("reserve:count")) || "0", 10) || 0;
  }
  return Response.json({ reserved: n });
}
