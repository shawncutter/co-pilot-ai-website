// Outbound email via Resend (https://resend.com). Swap the transport here if you prefer Postmark/SES.
import { esc, mdToHtml } from './util.js';

export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (env.EMAIL_MOCK === '1') {
    (globalThis.__sentEmails ||= []).push({ to, subject, html, text });
    return { id: 'mock_' + (globalThis.__sentEmails.length) };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, // e.g. "Co-Pilot <coach@co-pilot.ai>"
      to: [to],
      subject,
      html,
      text,
      reply_to: replyTo || env.EMAIL_REPLY_TO || undefined,
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend failed: ${d?.message || res.status}`);
  return d;
}

const shell = (env, inner) => `<!doctype html><html><body style="margin:0;background:#0e0e10;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ececee">
<div style="max-width:620px;margin:0 auto;background:#141417;border:1px solid #2a2a2e;border-radius:12px;padding:28px">
<div style="font-family:Georgia,serif;font-size:20px;font-weight:700;margin-bottom:18px;color:#fff">Co-Pilot<span style="color:#c27d56">.ai</span> <span style="font-size:13px;color:#7e8085;font-family:-apple-system,Arial">AI Coaching</span></div>
<div style="font-size:15px;line-height:1.6;color:#d9d9dc">${inner}</div>
<hr style="border:none;border-top:1px solid #2a2a2e;margin:24px 0"/>
<div style="font-size:12px;color:#7e8085;line-height:1.5">Co-Pilot is operated by ${esc(env.LEGAL_ENTITY || 'Phase 2 Labs LLC')}. AI coaching, not legal, financial or medical advice.<br/>
<a href="${env.APP_URL}/portal" style="color:#df9b74">Your portal</a> · <a href="${env.APP_URL}/login" style="color:#df9b74">Sign-in link</a> · Manage or cancel anytime from your portal.</div>
</div></body></html>`;

const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${href}" style="background:#c27d56;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

// Light styling for markdown-rendered drops inside email clients.
const styleDrop = (h) =>
  h
    .replace(/<h2>/g, '<h2 style="font-family:Georgia,serif;color:#fff;font-size:18px;margin:24px 0 8px">')
    .replace(/<h3>/g, '<h3 style="color:#fff;font-size:16px;margin:18px 0 6px">')
    .replace(/<pre>/g, '<pre style="background:#0e0e10;border:1px solid #2a2a2e;border-radius:8px;padding:12px;white-space:pre-wrap;font-size:13px;color:#ececee">')
    .replace(/<a /g, '<a style="color:#df9b74" ');

export function dropEmail(env, { subject, bodyMd, portalUrl }) {
  return {
    subject,
    html: shell(env, styleDrop(mdToHtml(bodyMd)) + button(portalUrl, 'Open in your portal')),
    text: `${bodyMd}\n\nOpen in your portal: ${portalUrl}`,
  };
}

export function magicLinkEmail(env, { link }) {
  return {
    subject: 'Your Co-Pilot sign-in link',
    html: shell(env, `<p>Here's your secure link to your Co-Pilot portal. It works for 30 days.</p>${button(link, 'Open my portal')}`),
    text: `Open your Co-Pilot portal: ${link}`,
  };
}

export function welcomeIntakeEmail(env, { link }) {
  return {
    subject: "You're in — 2 minutes to get your Co-Pilot starter package",
    html: shell(env, `<p>Welcome aboard. Tell us about your role and what you want AI to do for you, and your starter package lands right after. Your weekly briefing follows every Monday.</p>${button(link, 'Get my starter package')}`),
    text: `Get your starter package: ${link}`,
  };
}

// The only messages that go to Shawn: a 1:1 pricing request, and a paid 1:1 session.
export function consultingRequestAlertEmail(env, { email, name, company, topic, timing, member, profileSummary }) {
  return {
    subject: `1:1 pricing request from ${name || email}`,
    html: shell(env, `<p><strong>${esc(name || email)}</strong> (${esc(email)})${company ? ` at ${esc(company)}` : ''} asked for 1:1 pricing.</p>
<p><strong>Wants to work on:</strong> ${esc(topic)}</p>
<p><strong>Timing:</strong> ${esc(timing || 'not specified')}</p>
<p><strong>Member:</strong> ${member ? 'yes' : 'no'}${profileSummary ? `<br/>${esc(profileSummary)}` : ''}</p>
<p>Reply to this email to quote. To bill after the session: <code>npm run bill:hours -- ${esc(email)} &lt;hours&gt;</code></p>`),
    text: `1:1 pricing request from ${name || email} <${email}>${company ? ` (${company})` : ''}. Topic: ${topic}. Timing: ${timing || 'n/a'}. Member: ${member ? 'yes' : 'no'}.`,
  };
}

export function consultingRequestAckEmail(env, { name }) {
  return {
    subject: 'We got your 1:1 request',
    html: shell(env, `<p>Thanks${name ? ', ' + esc(name) : ''}. We've received your request for a 1:1 session and will reply with pricing and a few times that work.</p>`),
    text: "We've received your 1:1 request and will reply with pricing and times.",
  };
}

export function consultingAlertEmail(env, { email, hours, amount, topic, profileSummary }) {
  return {
    subject: `1:1 paid: ${hours}h by ${email}`,
    html: shell(env, `<p><strong>${esc(email)}</strong> prepaid <strong>${hours} hour(s)</strong> ($${(amount / 100).toLocaleString()}).</p>
<p><strong>Topic:</strong> ${esc(topic || 'not specified')}</p>
<p><strong>Their profile:</strong><br/>${esc(profileSummary || 'Not a subscriber yet')}</p>
<p>They've been sent your booking link. Nothing else needs you.</p>`),
    text: `${email} prepaid ${hours}h. Topic: ${topic || 'n/a'}. Profile: ${profileSummary || 'n/a'}`,
  };
}

export function consultingConfirmEmail(env, { hours }) {
  const link = env.BOOKING_URL || `${env.APP_URL}/portal`;
  return {
    subject: 'Your 1:1 session is confirmed — pick a time',
    html: shell(env, `<p>Thanks — your ${hours} hour(s) of 1:1 time are paid and confirmed. Grab a time that works for you:</p>${button(link, 'Book my session')}`),
    text: `Book your ${hours}h session: ${link}`,
  };
}

export function opsAlertEmail(env, { subject, detail }) {
  return { subject: `[Coach ops] ${subject}`, html: shell(env, `<pre style="white-space:pre-wrap">${esc(detail)}</pre>`), text: detail };
}
