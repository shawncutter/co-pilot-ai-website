// Cloudflare Pages Function — destination vote aggregation
// Route: /api/vote   (GET = read tallies, POST {id} = add a vote)
// Requires a KV namespace bound as "VOTES" (see SETUP.md).

const CITIES = ["sf", "nyc", "home", "vegas", "la"];

// Optional starting tallies so the poll doesn't launch at all-zeros.
// Set every value to 0 for a fully honest cold start.
const SEED = { sf: 0, nyc: 0, home: 0, vegas: 0, la: 0 };

async function readCounts(kv) {
  const out = {};
  await Promise.all(
    CITIES.map(async (c) => {
      const v = await kv.get("city:" + c);
      out[c] = v === null ? (SEED[c] || 0) : parseInt(v, 10) || 0;
    })
  );
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.VOTES; // KV namespace binding

  if (!kv) {
    return new Response(JSON.stringify({ error: "VOTES KV not bound" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "GET") {
    return Response.json({ counts: await readCounts(kv) });
  }

  if (request.method === "POST") {
    let id = null;
    try {
      id = (await request.json()).id;
    } catch (e) {}
    if (!CITIES.includes(id)) {
      return new Response(JSON.stringify({ error: "bad id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const cur = await kv.get("city:" + id);
    const next = (cur === null ? (SEED[id] || 0) : parseInt(cur, 10) || 0) + 1;
    await kv.put("city:" + id, String(next));
    return Response.json({ counts: await readCounts(kv) });
  }

  return new Response("Method not allowed", { status: 405 });
}
