// Netlify Function — destination vote aggregation
// Route: /api/vote   (GET = read tallies, POST {id} = add a vote)
// Uses Netlify Blobs for storage (no external DB needed). See SETUP.md.

import { getStore } from "@netlify/blobs";

const CITIES = ["sf", "nyc", "home", "vegas", "la"];

// Optional starting tallies. Set all to 0 for an honest cold start.
const SEED = { sf: 0, nyc: 0, home: 0, vegas: 0, la: 0 };

async function readCounts(store) {
  const out = {};
  for (const c of CITIES) {
    const v = await store.get("city:" + c);
    out[c] = v === null || v === undefined ? (SEED[c] || 0) : parseInt(v, 10) || 0;
  }
  return out;
}

export default async (req) => {
  const store = getStore("dest-votes");

  if (req.method === "GET") {
    return Response.json({ counts: await readCounts(store) });
  }

  if (req.method === "POST") {
    let id = null;
    try {
      id = (await req.json()).id;
    } catch (e) {}
    if (!CITIES.includes(id)) {
      return new Response(JSON.stringify({ error: "bad id" }), { status: 400 });
    }
    const cur = await store.get("city:" + id);
    const next =
      (cur === null || cur === undefined ? (SEED[id] || 0) : parseInt(cur, 10) || 0) + 1;
    await store.set("city:" + id, String(next));
    return Response.json({ counts: await readCounts(store) });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/vote" };
