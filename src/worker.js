// co-pilot.ai Worker
// - Serves the static site in ./public (Workers static assets).
// - /book/*  → SecondBrain's public scheduler (hey.shawncutter.com). Booking there puts the
//              time on Shawn's calendar and SecondBrain sends the confirmation and notifications.
// - /api/lead → every sign-up and request on the site. Each one is forwarded to SecondBrain:
//      1. an email to LEAD_NOTIFY_TO (default shawn@energiacres.com, the inbox SecondBrain syncs),
//         sent with Resend when RESEND_API_KEY is set;
//      2. a signed JSON webhook to SECONDBRAIN_WEBHOOK_URL when set (HMAC-SHA256 with
//         SECONDBRAIN_WEBHOOK_SECRET), for SecondBrain's visitor-message endpoint once it ships;
//      3. a backup copy in the LEADS KV namespace when it is bound.
//   The request succeeds if at least one of these succeeds.

const SCHEDULER = "https://hey.shawncutter.com/schedule/";
const BOOKING = {
  "/book": "15-minute-introduction",
  "/book/intro": "15-minute-introduction",
  "/book/15": "15-minute-introduction",
  "/book/30": "30-minute-meeting",
  "/book/60": "60-minute-working-session",
};

const KINDS = {
  waitlist: "Waitlist",
  pricing: "1:1 pricing request",
  founder: "Founder conversation",
  studio: "Studio waitlist",
  collective: "Collective application",
};

// Fields accepted per kind, with max lengths. Anything else is dropped.
const FIELDS = {
  email: 254,
  name: 120,
  business: 120,
  question: 2000,
  topic: 2000,
  building: 2000,
  role: 80,
  link: 500,
  page: 120,
};

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export function cleanLead(raw) {
  if (!raw || typeof raw !== "object") return { error: "Bad request." };
  const kind = String(raw.kind || "");
  if (!KINDS[kind]) return { error: "Unknown form." };
  // Honeypot: real visitors never see or fill this field. (No timing check: browser autofill
  // lets a real person submit in under a second, and those leads must never be dropped.)
  if (raw.website) return { spam: true };

  const lead = { kind };
  for (const [key, max] of Object.entries(FIELDS)) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    const s = String(v).replace(/\r\n?/g, "\n").trim().slice(0, max);
    if (s) lead[key] = s;
  }
  lead.email = (lead.email || "").toLowerCase();
  if (!EMAIL_RE.test(lead.email)) return { error: "Please enter a valid email address." };
  if (lead.link && !/^https?:\/\//i.test(lead.link)) lead.link = "https://" + lead.link;
  return { lead };
}

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function leadEmail(lead, env) {
  const label = KINDS[lead.kind];
  const who = lead.name ? `${oneLine(lead.name)} <${lead.email}>` : lead.email;
  const detail = oneLine(lead.business || lead.role || "").slice(0, 60);
  const subject = `[Co-Pilot] ${label}: ${who}${detail ? " · " + detail : ""}`;
  const rows = [
    ["Form", label],
    ["Email", lead.email],
    ["Name", lead.name],
    ["Business", lead.business],
    ["Role", lead.role],
    ["Biggest AI question", lead.question],
    ["Wants to work on", lead.topic],
    ["Building", lead.building],
    ["Link", lead.link],
    ["Page", lead.page],
    ["Received", lead.received_at],
    ["From", lead.country],
  ].filter(([, v]) => v);
  const next = {
    waitlist: "Next: add to the founding list; reply to welcome them.",
    pricing: "Next: reply with a quote and times, or send https://co-pilot.ai/book/60 after quoting. Bill with npm run bill:hours.",
    founder: "Next: reply personally, or send https://co-pilot.ai/book/30",
    studio: "Next: add to the Studio list for Edition 01.",
    collective: "Next: review what they built and reply.",
  }[lead.kind];
  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\n${next}\nReply to this email to answer them directly.\n\nLead id: ${lead.id}`;
  return {
    from: env.LEAD_FROM || "Co-Pilot <copilot@updates.shawncutter.com>",
    to: [env.LEAD_NOTIFY_TO || "shawn@energiacres.com"],
    reply_to: lead.email,
    subject,
    text,
    headers: { "X-Co-Pilot-Lead": lead.kind },
  };
}

async function sendEmail(lead, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(leadEmail(lead, env)),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendWebhook(lead, env) {
  const body = JSON.stringify({ source: "co-pilot.ai", type: "lead." + lead.kind, lead });
  const ts = Math.floor(Date.now() / 1000);
  const headers = { "content-type": "application/json" };
  if (env.SECONDBRAIN_WEBHOOK_SECRET) {
    headers["x-co-pilot-signature"] = `t=${ts},v1=${await hmacHex(env.SECONDBRAIN_WEBHOOK_SECRET, `${ts}.${body}`)}`;
  }
  const res = await fetch(env.SECONDBRAIN_WEBHOOK_URL, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function saveCopy(lead, env) {
  await env.LEADS.put(`lead:${lead.received_at}:${lead.id}`, JSON.stringify(lead), {
    metadata: { kind: lead.kind, email: lead.email },
  });
}

async function handleLead(request, env) {
  // site.js posts JSON. Without JavaScript the browser posts the form itself; answer that with a
  // page instead of JSON.
  const native = !(request.headers.get("content-type") || "").includes("application/json");
  const reply = (body, status) =>
    native ? Response.redirect(new URL(body.ok ? "/thanks/" : "/sorry/", request.url).toString(), 303) : json(body, status);

  let raw;
  try {
    raw = await readBody(request);
  } catch {
    return reply({ ok: false, error: "Bad request." }, 400);
  }
  const { lead, error, spam } = cleanLead(raw);
  if (spam) return reply({ ok: true }, 200);
  if (error) return reply({ ok: false, error }, 400);

  lead.id = crypto.randomUUID();
  lead.received_at = new Date().toISOString();
  lead.country = request.cf && request.cf.country ? String(request.cf.country) : undefined;

  const jobs = [];
  if (env.RESEND_API_KEY) jobs.push(["email", sendEmail(lead, env)]);
  if (env.SECONDBRAIN_WEBHOOK_URL) jobs.push(["secondbrain", sendWebhook(lead, env)]);
  if (env.LEADS) jobs.push(["kv", saveCopy(lead, env)]);
  if (!jobs.length) {
    console.error("lead not delivered: no destination configured", lead.kind);
    return reply({ ok: false, error: "Not configured." }, 503);
  }
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  const delivered = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") delivered.push(jobs[i][0]);
    else console.error("lead delivery failed", jobs[i][0], String(r.reason));
  });
  if (!delivered.length) return reply({ ok: false, error: "Could not save that. Please try again." }, 502);
  return reply({ ok: true, id: lead.id }, 200);
}

function bookingRedirect(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const slug = BOOKING[path];
  if (!slug) return null;
  const to = new URL(SCHEDULER + slug);
  to.searchParams.set("utm_source", "co-pilot.ai");
  return Response.redirect(to.toString(), 302);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // One canonical address: www.co-pilot.ai → co-pilot.ai
    if (url.hostname === "www.co-pilot.ai") {
      url.hostname = "co-pilot.ai";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
      return handleLead(request, env);
    }

    const booking = bookingRedirect(url);
    if (booking) return booking;

    return env.ASSETS.fetch(request);
  },
};
