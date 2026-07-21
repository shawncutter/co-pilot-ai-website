// Netlify Function — live reserved-deposit count
// Route: /api/reserved  (GET => { reserved: <number> })
import { getStore } from "@netlify/blobs";

export default async () => {
  const store = getStore("reserve");
  const n = parseInt((await store.get("count")) || "0", 10) || 0;
  return Response.json({ reserved: n });
};

export const config = { path: "/api/reserved" };
