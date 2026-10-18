// Multi-model router. Each task has a preferred order of providers; if a provider
// has no key configured or errors, the router falls through to the next one.
// Model IDs come from env vars so you can move to new models without code changes.

export const ROUTES = {
  digest:   ['gemini', 'anthropic', 'openai', 'oss'],   // long-context: a whole week of notes
  frontier: ['xai', 'gemini', 'anthropic'],             // Grok: what AI builders posted on X this week
  redact:   ['oss', 'anthropic', 'openai'],             // cheap + private preprocessing
  adapt:    ['anthropic', 'openai', 'gemini'],          // write each subscriber's drop
  qa:       ['openai', 'anthropic', 'gemini'],          // second-model check on every drop
  teaser:   ['xai', 'anthropic', 'openai'],             // Grok bot public teaser
  sample:   ['anthropic', 'openai', 'gemini'],          // free "wow" sample
  starter:  ['anthropic', 'openai', 'gemini'],          // one-time starter package after signup
};

const PROVIDERS = {
  anthropic: {
    ready: (env) => env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL,
    async call(env, { system, prompt, maxTokens }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message || `anthropic ${res.status}`);
      return d.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    },
  },
  openai: {
    ready: (env) => env.OPENAI_API_KEY && env.OPENAI_MODEL,
    call: (env, args) => openAICompatible('https://api.openai.com/v1', env.OPENAI_API_KEY, env.OPENAI_MODEL, args),
  },
  xai: {
    // Grok — OpenAI-compatible API. XAI_SEARCH_JSON lets you pass xAI's current
    // live-search/tool config (e.g. X search) as raw JSON without a code change.
    ready: (env) => env.XAI_API_KEY && env.XAI_MODEL,
    call: (env, args) =>
      openAICompatible('https://api.x.ai/v1', env.XAI_API_KEY, env.XAI_MODEL, args,
        env.XAI_SEARCH_JSON ? JSON.parse(env.XAI_SEARCH_JSON) : undefined),
  },
  gemini: {
    ready: (env) => env.GEMINI_API_KEY && env.GEMINI_MODEL,
    async call(env, { system, prompt, maxTokens }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message || `gemini ${res.status}`);
      return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
  oss: {
    // Open-source models via OpenRouter (Llama, Qwen, DeepSeek…) or ANY OpenAI-compatible
    // endpoint you run yourself (e.g. MLX Serve / llama.cpp) via OSS_BASE_URL.
    ready: (env) => env.OSS_API_KEY && env.OSS_MODEL,
    call: (env, args) =>
      openAICompatible(env.OSS_BASE_URL || 'https://openrouter.ai/api/v1', env.OSS_API_KEY, env.OSS_MODEL, args),
  },
};

async function openAICompatible(base, key, model, { system, prompt, maxTokens }, extra) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      ...(extra || {}),
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.error?.message || `${base} ${res.status}`);
  return d.choices?.[0]?.message?.content || '';
}

/**
 * Run a task through the router.
 * @returns {Promise<{text: string, provider: string}>}
 */
export async function runTask(env, task, { system, prompt, maxTokens = 2000 }) {
  if (env.MODEL_MOCK === '1') return { text: mockText(task, prompt), provider: 'mock' };
  const order = ROUTES[task] || ROUTES.adapt;
  const errors = [];
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p.ready(env)) continue;
    try {
      const text = await p.call(env, { system, prompt, maxTokens });
      if (text && text.trim()) return { text: text.trim(), provider: name };
      errors.push(`${name}: empty response`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`No provider completed task "${task}". ${errors.join(' | ') || 'No providers configured.'}`);
}

export function configuredProviders(env) {
  return Object.keys(PROVIDERS).filter((n) => PROVIDERS[n].ready(env));
}

// Deterministic output for tests / dry runs, shaped like real responses.
function mockText(task, prompt) {
  const snippet = String(prompt).replace(/\s+/g, ' ').slice(0, 120);
  switch (task) {
    case 'redact':
      return String(prompt).split('<<<TEXT>>>').pop().replace(/EnergiAcres|Terrasow/gi, '[REDACTED]').trim();
    case 'qa':
      return 'PASS\n- Format OK\n- No confidential details found';
    case 'teaser':
      return 'This week the frontier moved again: parallel agents, cheaper local models. Here is how one founder uses them. #AI';
    case 'frontier':
      return '- Builders are running several agents in parallel and reviewing output.\n- Local open-source models are now good enough for private preprocessing.';
    case 'digest':
      return '## This week in how Shawn used AI\n- Orchestrated parallel agents for deal screening\n- Built a slide deck from a design system in one shot';
    default:
      return `# Your AI week\n\n## 1. Try this today\nA ready-to-run prompt adapted for you.\n\n\`\`\`\nPrompt: ${snippet}\n\`\`\`\n\n## 2. Why it matters\nThis mirrors how Shawn worked this week.`;
  }
}
