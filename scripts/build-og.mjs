// Builds the link-preview (Open Graph) images in public/og/ — the 1200x630 cards iMessage, Slack,
// LinkedIn and X show when someone shares a co-pilot.ai link.
//
//   node scripts/build-og.mjs
//
// One card per page, plus a default for pages without their own (thank-you, 404, ...).
// Edit CARDS below to change copy, then re-run and commit the PNGs. Needs `sharp` (it ships with
// wrangler, so it is already in node_modules) and macOS system fonts (Avenir Next, Menlo).
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og");
const W = 1200, H = 630;
const SANS = "'Avenir Next','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "Menlo,'SF Mono',monospace";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- motifs: the right-hand illustration, drawn in a 440x440 box placed at (700, 95) ------------
const motifs = {
  // a capture log: the "how I used AI this week" stream
  log: () => {
    const rows = [
      ["#ffc9a0", "call → follow-up drafted"],
      ["#e39158", "contract → 2nd-model review"],
      ["#ffd5b3", "inbox → triaged, 14 → 3"],
      ["#c8743f", "pricing → agent ran the math"],
      ["#e39158", "deploy → shipped 6:42am"],
      ["#ffc9a0", "briefing → built for you"],
    ];
    const lines = rows.map(([c, t], i) => `
      <rect x="28" y="${74 + i * 56}" width="8" height="26" rx="4" fill="${c}"/>
      <text x="52" y="${94 + i * 56}" font-family="${MONO}" font-size="20" fill="#d4d4d8">${esc(t)}</text>`).join("");
    return `
      <rect x="0" y="0" width="440" height="440" rx="22" fill="#0b0b0c" stroke="#3a3a3a" stroke-width="2"/>
      <path d="M0 22a22 22 0 0 1 22-22h396a22 22 0 0 1 22 22v34H0z" fill="#161617"/>
      <circle cx="30" cy="28" r="6" fill="#3a3a3a"/><circle cx="52" cy="28" r="6" fill="#3a3a3a"/><circle cx="74" cy="28" r="6" fill="#3a3a3a"/>
      <text x="110" y="34" font-family="${MONO}" font-size="16" fill="#9a9a9f">capture.log</text>${lines}`;
  },
  // the Monday briefing and its price
  price: () => `
      <rect x="0" y="0" width="440" height="440" rx="22" fill="#fafafa"/>
      <text x="36" y="62" font-family="${MONO}" font-size="17" fill="#8a8a8f" letter-spacing="2">MONDAY BRIEFING</text>
      <text x="32" y="210" font-family="${SANS}" font-weight="800" font-size="170" fill="#0a0a0a" letter-spacing="-8">$50</text>
      <text x="40" y="262" font-family="${SANS}" font-weight="600" font-size="28" fill="#9a4f25">a month · founding rate</text>
      <rect x="36" y="296" width="368" height="2" fill="#e4e4e7"/>
      ${["Three moves for your business", "Your starter package, day one", "Every past briefing, in your portal"].map((t, i) => `
      <circle cx="46" cy="${338 + i * 36}" r="7" fill="#c8743f"/>
      <text x="66" y="${345 + i * 36}" font-family="${SANS}" font-weight="500" font-size="20" fill="#27272a">${esc(t)}</text>`).join("")}`,
  // one founder, a team of agents orbiting
  orbit: () => {
    const nodes = [[220, 40, 1], [392, 150, 0], [350, 340, 1], [120, 395, 0], [48, 215, 1], [105, 78, 0]];
    return `
      <circle cx="220" cy="220" r="190" fill="none" stroke="#2a2a2c" stroke-width="2" stroke-dasharray="3 9"/>
      <circle cx="220" cy="220" r="120" fill="none" stroke="#3a3a3a" stroke-width="2"/>
      ${nodes.map(([x, y]) => `<line x1="220" y1="220" x2="${x}" y2="${y}" stroke="#c8743f" stroke-opacity=".45" stroke-width="2"/>`).join("")}
      ${nodes.map(([x, y, hi]) => `<circle cx="${x}" cy="${y}" r="${hi ? 17 : 13}" fill="${hi ? "url(#foil)" : "#0b0b0c"}" stroke="${hi ? "none" : "#e39158"}" stroke-width="3"/>`).join("")}
      <circle cx="220" cy="220" r="62" fill="url(#foil)"/>
      <circle cx="220" cy="220" r="62" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
      <text x="220" y="232" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="34" fill="#170b04">YOU</text>`;
  },
  // a build weekend: Friday → Sunday, ending in a customer
  timeline: () => {
    const steps = [["FRI", "Problem", 0.35], ["SAT", "Build", 0.7], ["SUN", "Customers", 1]];
    return steps.map(([d, t, f], i) => `
      <g transform="translate(0 ${i * 150})">
        <rect x="0" y="0" width="440" height="122" rx="18" fill="#0b0b0c" stroke="#3a3a3a" stroke-width="2"/>
        <text x="30" y="46" font-family="${MONO}" font-size="18" fill="#ffc9a0" letter-spacing="3">${d}</text>
        <text x="30" y="92" font-family="${SANS}" font-weight="750" font-size="38" fill="#fff" letter-spacing="-1">${t}</text>
        <rect x="270" y="48" width="136" height="26" rx="13" fill="#1d1d1f"/>
        <rect x="270" y="48" width="${136 * f}" height="26" rx="13" fill="url(#foil)"/>
      </g>`).join("");
  },
  // a constellation: practitioners connected to each other
  mesh: () => {
    const p = [[70, 90], [215, 40], [370, 110], [120, 235], [290, 255], [60, 380], [215, 400], [385, 370]];
    const e = [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4], [3, 4], [3, 5], [3, 6], [4, 6], [4, 7], [2, 7], [5, 6], [6, 7]];
    return `
      ${e.map(([a, b]) => `<line x1="${p[a][0]}" y1="${p[a][1]}" x2="${p[b][0]}" y2="${p[b][1]}" stroke="#c8743f" stroke-opacity=".5" stroke-width="2"/>`).join("")}
      ${p.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 || i === 4 ? 24 : 15}" fill="${i === 3 || i === 4 ? "url(#foil)" : "#0b0b0c"}" stroke="#e39158" stroke-width="3"/>`).join("")}`;
  },
  // a quiet lock
  lock: () => `
      <rect x="95" y="190" width="250" height="200" rx="26" fill="#0b0b0c" stroke="#e39158" stroke-width="5"/>
      <path d="M150 190v-48a70 70 0 0 1 140 0v48" fill="none" stroke="#e39158" stroke-width="5" stroke-linecap="round"/>
      <circle cx="220" cy="277" r="22" fill="url(#foil)"/><rect x="211" y="285" width="18" height="50" rx="9" fill="url(#foil)"/>`,
};

// ---- the cards ----------------------------------------------------------------------------------
// lines: headline lines; `hi` marks the line(s) painted in copper foil.
const CARDS = [
  { file: "default", path: "co-pilot.ai", kicker: "A weekly AI briefing for business owners",
    lines: ["Our week of", "AI, made", "yours."], hi: [1, 2], size: 92, motif: "log",
    sub: ["Every week I run my companies on AI.", "You get the parts that work for yours."] },
  { file: "membership", path: "co-pilot.ai/membership", kicker: "MEMBERSHIP",
    lines: ["One membership.", "$50 a month."], hi: [1], size: 66, motif: "price",
    sub: ["A Monday AI briefing adapted to your", "business, plus a starter package."] },
  { file: "founders", path: "co-pilot.ai/founders", kicker: "FOR FOUNDERS",
    lines: ["Become the", "founder you", "were meant", "to be."], hi: [3], size: 70, motif: "orbit", cta: "Start a conversation →",
    sub: ["Coaching for the whole person, in the", "age of agent teams."] },
  { file: "studio", path: "co-pilot.ai/studio", kicker: "AI FACTORY STUDIO",
    lines: ["Revenue,", "not prototypes."], hi: [1], size: 82, motif: "timeline", cta: "Join the Studio waitlist →",
    sub: ["Build weekends that leave with customers."] },
  { file: "collective", path: "co-pilot.ai/collective", kicker: "THE COLLECTIVE",
    lines: ["Practitioners,", "not presenters."], hi: [1], size: 82, motif: "mesh", cta: "Apply to join →",
    sub: ["Technologists who build with AI every", "day, and are each other's co-pilots."] },
  { file: "privacy", path: "co-pilot.ai/privacy", kicker: "PRIVACY",
    lines: ["What happens to", "what you share."], hi: [1], size: 74, motif: "lock", cta: null,
    sub: ["Plain English, no surprises."] },
];

// the call-to-action pill, bottom right; width follows the label
function pill(label) {
  if (!label) return "";
  const w = Math.round(label.length * 10.6 + 52);
  return `<rect x="${W - 72 - w}" y="560" width="${w}" height="40" rx="20" fill="none" stroke="#3a3a3a" stroke-width="2"/>
  <text x="${W - 72 - w / 2}" y="587" text-anchor="middle" font-family="${SANS}" font-weight="600" font-size="19" fill="#d4d4d8">${esc(label)}</text>`;
}

function svg(c) {
  const lh = c.size * 1.02;
  const top = 250 - ((c.lines.length - 3) * lh) / 2 + (c.lines.length > 3 ? 8 : 0);
  const head = c.lines.map((t, i) => `<text x="72" y="${top + i * lh}" font-family="${SANS}" font-weight="800" font-size="${c.size}" letter-spacing="${-c.size * 0.045}" fill="${c.hi.includes(i) ? "url(#foil)" : "#fff"}">${esc(t)}</text>`).join("");
  const subY = top + (c.lines.length - 1) * lh + 58;
  const sub = c.sub.map((t, i) => `<text x="74" y="${subY + i * 34}" font-family="${SANS}" font-weight="500" font-size="26" fill="#b4b4ba">${esc(t)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="foil" x1="0" y1="0" x2="1" y2="0.25">
      <stop offset="0" stop-color="#B5632F"/><stop offset=".35" stop-color="#E39158"/><stop offset=".55" stop-color="#FFD5B3"/><stop offset=".8" stop-color="#E39158"/><stop offset="1" stop-color="#B5632F"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC9A0"/><stop offset="1" stop-color="#C8743F"/></linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.35" r="0.65"><stop offset="0" stop-color="#C8743F" stop-opacity=".34"/><stop offset=".55" stop-color="#C8743F" stop-opacity=".07"/><stop offset="1" stop-color="#C8743F" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" stroke-opacity=".045" stroke-width="1"/></pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".0"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#000"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="url(#foil)"/>
  <g transform="translate(72 52)">
    <circle cx="14" cy="22" r="13" fill="none" stroke="#fff" stroke-width="3"/>
    <circle cx="26" cy="22" r="13" fill="none" stroke="url(#ring)" stroke-width="3"/>
    <text x="52" y="30" font-family="${SANS}" font-weight="700" font-size="28" fill="#fff" letter-spacing="-.5">Co-Pilot</text>
  </g>
  <text x="73" y="${top - c.size - 6}" font-family="${SANS}" font-weight="650" font-size="21" fill="#ffc9a0" letter-spacing="${c.kicker === c.kicker.toUpperCase() ? 3 : 0.2}">${esc(c.kicker)}</text>
  ${head}${sub}
  <g transform="translate(700 95)">${motifs[c.motif]()}</g>
  <text x="73" y="588" font-family="${MONO}" font-size="21" fill="#8a8a90">${esc(c.path)}</text>
  ${pill(c.cta === undefined ? "Join the waitlist →" : c.cta)}
</svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const c of CARDS) {
  const png = await sharp(Buffer.from(svg(c))).png({ compressionLevel: 9, palette: false }).toBuffer();
  writeFileSync(join(OUT, `${c.file}.png`), png);
  console.log(`og/${c.file}.png  ${(png.length / 1024).toFixed(0)} KB`);
}
