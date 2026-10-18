// Passwordless access: signed, expiring magic-link tokens. No accounts to manage.
import { hmacHex, safeEqual } from './util.js';

const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};

// Default lifetime: 30 days, so links inside weekly emails keep working.
export async function signToken(secret, subscriberId, ttlSeconds = 60 * 60 * 24 * 30) {
  const payload = b64u.enc(JSON.stringify({ sid: subscriberId, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = await hmacHex(secret, payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(b64u.dec(payload));
    if (!data.sid || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.sid;
  } catch {
    return null;
  }
}
