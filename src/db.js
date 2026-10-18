// Thin helpers over Cloudflare D1 (also works with the test shim in test/d1-shim.js).
export const all = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results || [];
export const first = (db, sql, ...p) => db.prepare(sql).bind(...p).first();
export const run = (db, sql, ...p) => db.prepare(sql).bind(...p).run();

export const getSubscriberByEmail = (db, email) =>
  first(db, 'SELECT * FROM subscribers WHERE email = ?', email.toLowerCase().trim());
export const getSubscriber = (db, id) => first(db, 'SELECT * FROM subscribers WHERE id = ?', id);
export const getProfiles = (db, subscriberId) =>
  all(db, 'SELECT * FROM profiles WHERE subscriber_id = ? ORDER BY created_at', subscriberId);
export const getProfile = (db, id) => first(db, 'SELECT * FROM profiles WHERE id = ?', id);

export const profileLimit = (plan) => (plan === 'pro' ? 2 : 1);
export const promptCount = (plan) => (plan === 'pro' ? 5 : 3);

export function profileSummary(p) {
  if (!p) return '';
  return [p.role, p.industry, p.goals && `Goals: ${p.goals}`].filter(Boolean).join(' — ');
}
