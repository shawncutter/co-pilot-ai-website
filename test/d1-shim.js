// A Cloudflare D1-compatible shim over Node's built-in SQLite, for tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDB(schemaPath) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaPath, 'utf8'));
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (params = []) => ({
        run: async () => { const r = stmt.run(...norm(params)); return { success: true, meta: { changes: r.changes } }; },
        first: async (col) => { const r = stmt.get(...norm(params)); return r ? (col ? r[col] : { ...r }) : null; },
        all: async () => ({ results: stmt.all(...norm(params)).map((r) => ({ ...r })) }),
      });
      return { bind: (...p) => bound(p), ...bound([]) };
    },
  };
}

export function makeCtx() {
  const pending = [];
  return { waitUntil: (p) => pending.push(Promise.resolve(p)), flush: () => Promise.all(pending.splice(0)) };
}
