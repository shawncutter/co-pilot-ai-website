// Two-layer privacy filter applied to EVERYTHING captured from Shawn's week
// before any subscriber-facing step sees it:
//   1) deterministic: your blocklist (REDACT_TERMS) + emails, phones, $ amounts, URLs w/ tokens
//   2) model pass (open-source first) to genericize anything the rules missed.
import { runTask } from './models.js';
import { REDACT } from './prompts.js';

export function ruleRedact(text, termsCsv = '') {
  let out = String(text || '');
  const terms = termsCsv
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first
  for (const t of terms) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '[REDACTED]');
  }
  return out
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]')
    .replace(/\$\s?\d[\d,]*(\.\d+)?\s?(k|m|mm|b|bn|million|billion)?\b/gi, '[$ amount]')
    .replace(/https?:\/\/\S*(token|key|secret|sig|auth)=\S*/gi, '[private link]');
}

export async function redact(env, text) {
  const first = ruleRedact(text, env.REDACT_TERMS || '');
  if (env.REDACT_MODEL_PASS === '0') return first;
  try {
    const { text: second } = await runTask(env, 'redact', {
      system: REDACT.system,
      prompt: REDACT.prompt(first),
      maxTokens: 3000,
    });
    // Belt and braces: re-apply the rules to the model's output too.
    return ruleRedact(second, env.REDACT_TERMS || '');
  } catch {
    return first; // never block the week on the model pass; rules already applied
  }
}
