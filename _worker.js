/* ============================================================================
   EMIFlow — Cloudflare Pages Advanced Mode worker
   API: /api/* → Turso (libsql HTTP v2, fully batched pipelines).
   Everything else → static assets.
   Secret (encrypted Pages env): DB_TOKEN (long-lived Turso DB JWT)
   Design note: every route minimizes edge↔DB round trips by batching
   statements into a single /v2/pipeline request (DB may be intercontinental
   from the worker colo; users in IN hit BOM↔BOM which is fast).
   ============================================================================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const CLEAN = { '/download': '/download.html', '/privacy': '/privacy.html', '/terms': '/terms.html', '/faq': '/faq.html', '/ui-options': '/ui-options.html' };
    if (CLEAN[url.pathname] && request.method === 'GET') {
      const inner = await env.ASSETS.fetch(new URL(CLEAN[url.pathname], url.origin));
      if (inner && inner.status === 200) { const r = new Response(inner.body, inner); r.headers.set('content-type', 'text/html;charset=utf-8'); return r; }
    }
    if (url.pathname.startsWith('/api/')) {
      try { return await api(request, env, url); }
      catch (e) {
        console.error('api error', e);
        return json({ ok: false, error: 'server_error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

/* ------------------------------ helpers ---------------------------------- */

const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const readBody = async (req) => { try { return await req.json(); } catch { return {}; } };

const enc = new TextEncoder();
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256b64url(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  let bin = ''; new Uint8Array(d).forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const randHex = (n = 32) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

async function hashPassword(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------ database --------------------------------- */

const DB_HOST = (env && env.DB_HOST) ||
  (env && env.TURSO_URL && env.TURSO_URL.replace(/^libsql:\/\//, 'https://') + '/v2/pipeline') ||
  'https://emiflow-ajitjaat1011-ui.aws-ap-south-1.turso.io/v2/pipeline';

async function pipeline(env, stmts) {
  if (!env.DB_TOKEN) throw new Error('DB_TOKEN secret missing');
  const encArg = (v) =>
    v === null || v === undefined ? { type: 'null' } :
    typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: String(v) }) :
    typeof v === 'boolean' ? { type: 'integer', value: v ? '1' : '0' } :
    { type: 'text', value: String(v) };
  const r = await fetch(DB_HOST, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.DB_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: stmts.map(([sql, args]) => ({ type: 'execute', stmt: { sql, args: (args || []).map(encArg) } })) }),
  });
  if (!r.ok) {
    let body = '';
    try { body = (await r.text()).slice(0, 300); } catch {}
    throw new Error('db http ' + r.status + ': ' + body);
  }
  const d = await r.json();
  const out = [];
  for (const res of d.results || []) {
    if (res.type === 'error') throw new Error('db: ' + (res.error ? res.error.message : 'pipeline error'));
    if (res.type === 'ok' && res.response && res.response.type === 'execute') {
      const rr = res.response.result;
      out.push(rr.rows.map(row => row.map(c => c.value)));
    } else out.push([]);
  }
  return out;
}
const db = (env, sql, args = []) => pipeline(env, [[sql, args]]).then(a => a[0]);

let _init = null;
function initSchema(env) {
  if (_init) return _init;
  _init = pipeline(env, [
    [`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL, terms_version INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 0)`],
    [`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER)`],
    [`CREATE TABLE IF NOT EXISTS emis (id TEXT NOT NULL, uid TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(uid,id))`],
    [`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, emi_id TEXT, amt REAL, at INTEGER)`],
    [`CREATE TABLE IF NOT EXISTS meta (uid TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`],
    [`CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT, email TEXT, ok INTEGER, ts INTEGER)`],
    [`CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER, used_at INTEGER)`],
    [`CREATE TABLE IF NOT EXISTS analytics (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, e TEXT, s TEXT, x TEXT)`],
    [`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`],
    [`CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip, ts)`],
  ]).then(() => pipeline(env, [[`ALTER TABLE users ADD COLUMN phone TEXT`]]).catch(() => {}))
    .catch(e => { _init = null; throw e; });
  return _init;
}

/* ------------------------------ auth ------------------------------------- */

async function userOf(env, req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || token.length < 32) return null;
  const rows = (await pipeline(env, [
    [`SELECT s.expires_at, u.id, u.email, u.name, u.created_at, u.email_verified FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, [token]],
    [`UPDATE sessions SET last_seen = ? WHERE token = ?`, [Date.now(), token]],
  ]))[0];
  if (!rows.length) return null;
  if (rows[0][0] < Date.now()) { await db(env, `DELETE FROM sessions WHERE token = ?`, [token]); return null; }
  const [, id, email, name, created_at, email_verified] = rows[0];
  return { id, email, name, created_at, email_verified, token };
}

const sessionExpiry = () => Date.now() + 180 * 24 * 3600 * 1000; // 180 days

async function failCount(env, ip, email) {
  const since = Date.now() - 15 * 60 * 1000;
  const rows = await db(env, `SELECT COUNT(*) FROM login_attempts WHERE ts > ? AND (ip = ? OR email = ?) AND ok = 0`, [since, ip, email || '']);
  return rows[0][0];
}
const ipOf = (req) => req.headers.get('cf-connecting-ip') || '0.0.0.0';

/* ------------------------------ api router -------------------------------- */

async function api(request, env, url) {
  const route = url.pathname.replace(/^\/api/, '');
  const m = request.method;
  const ip = ipOf(request);

  /* ---- public ---- */
  if (route === '/health' && m === 'GET') {
    let okDb = false, ms = 0, dbErr = null;
    const t0 = Date.now();
    try { await db(env, 'SELECT 1'); okDb = true; ms = Date.now() - t0; } catch (e) { dbErr = String(e.message || e).slice(0, 160); ms = Date.now() - t0; }
    return json({ ok: true, service: 'emiflow', db: okDb, dbMs: ms, dbErr, time: Date.now() });
  }

  if (route === '/analytics' && m === 'POST') {
    const b = await readBody(request);
    await db(env, `INSERT INTO analytics (ts, e, s, x) VALUES (?,?,?,?)`, [Date.now(), String(b.e || '').slice(0, 40), String(b.s || '').slice(0, 40), String(b.x || '').slice(0, 120)]);
    return json({ ok: true });
  }

  if (route === '/auth/register' && m === 'POST') {
    await initSchema(env);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const pw = String(b.password || '');
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ ok: false, error: 'bad_email' }, 400);
    if (name.length < 2 || name.length > 40) return json({ ok: false, error: 'bad_name' }, 400);
    if (pw.length < 8 || pw.length > 200) return json({ ok: false, error: 'bad_password' }, 400);
    if (phone.length !== 10) return json({ ok: false, error: 'bad_phone' }, 400);
    if (await failCount(env, ip, email) >= 8) return json({ ok: false, error: 'rate_limited' }, 429);
    const dup = await db(env, `SELECT id FROM users WHERE email = ? OR (phone IS NOT NULL AND phone = ?)`, [email, phone]);
    if (dup.length) return json({ ok: false, error: 'email_taken' }, 409);
    const id = crypto.randomUUID(), salt = randHex(16), now = Date.now();
    const ph = await hashPassword(pw, salt);
    const token = randHex(32);
    await pipeline(env, [
      [`INSERT INTO users (id, email, name, salt, pass_hash, created_at, terms_version, email_verified, phone) VALUES (?,?,?,?,?,?,1,0,?)`, [id, email, name, salt, ph, now, phone]],
      [`INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen) VALUES (?,?,?,?,?)`, [token, id, now, sessionExpiry(), now]],
      [`INSERT INTO login_attempts (ip, email, ok, ts) VALUES (?,?,1,?)`, [ip, email, now]],
    ]);
    return json({ ok: true, token, user: { id, email, name, created_at: now, email_verified: 0 } }, 201);
  }

  if (route === '/auth/login' && m === 'POST') {
    await initSchema(env);
    const b = await readBody(request);
    const ident = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    const phone = ident.replace(/\D/g, '').slice(-10);
    const isPhone = /^\d{10}$/.test(phone) && !ident.includes('@');
    const q = isPhone ? phone : ident;
    if (await failCount(env, ip, q) >= 8) return json({ ok: false, error: 'rate_limited' }, 429);
    const rows = await db(env, `SELECT id, email, name, salt, pass_hash, created_at, email_verified FROM users WHERE ${isPhone ? 'phone = ?' : 'email = ?'}`, [q]);
    const ok = rows.length === 1 && (await hashPassword(pw, rows[0][3])) === rows[0][4];
    const token = randHex(32), now = Date.now();
    if (!ok) {
      await db(env, `INSERT INTO login_attempts (ip, email, ok, ts) VALUES (?,?,0,?)`, [ip, q, now]);
      return json({ ok: false, error: 'bad_credentials' }, 401);
    }
    const [id, em2, nm, , , created_at, email_verified] = rows[0];
    await pipeline(env, [
      [`INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen) VALUES (?,?,?,?,?)`, [token, id, now, sessionExpiry(), now]],
      [`INSERT INTO login_attempts (ip, email, ok, ts) VALUES (?,?,1,?)`, [ip, q, now]],
    ]);
    return json({ ok: true, token, user: { id, email: em2, name: nm, created_at, email_verified } });
  }

  if (route === '/auth/forgot-password' && m === 'POST') {
    await initSchema(env);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    if (await failCount(env, ip, email) >= 8) return json({ ok: false, error: 'rate_limited' }, 429);
    const rows = await db(env, `SELECT id FROM users WHERE email = ?`, [email]);
    let devCode = null;
    if (rows.length) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await db(env, `INSERT INTO password_resets (token_hash, user_id, expires_at, used_at) VALUES (?,?,?,NULL)`,
        [await sha256b64url(code + ':' + email), rows[0][0], Date.now() + 30 * 60 * 1000]);
      devCode = code; // email delivery not configured — surfaced in-app (same as telly-x)
    }
    return json({ ok: true, sent: true, code: devCode });
  }

  if (route === '/auth/reset-password' && m === 'POST') {
    await initSchema(env);
    const b = await readBody(request);
    const email = String(b.email || '').trim().toLowerCase();
    const code = String(b.code || '').trim();
    const pw = String(b.password || '');
    if (pw.length < 8) return json({ ok: false, error: 'bad_password' }, 400);
    const th = await sha256b64url(code + ':' + email);
    const rows = await db(env, `SELECT token_hash, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?`, [th]);
    if (!rows.length || rows[0][3] || rows[0][2] < Date.now()) return json({ ok: false, error: 'bad_code' }, 400);
    const uid = rows[0][1];
    const salt = randHex(16), ph = await hashPassword(pw, salt);
    await pipeline(env, [
      [`UPDATE users SET salt = ?, pass_hash = ? WHERE id = ?`, [salt, ph, uid]],
      [`UPDATE password_resets SET used_at = ? WHERE token_hash = ?`, [Date.now(), th]],
      [`DELETE FROM sessions WHERE user_id = ?`, [uid]],
    ]);
    return json({ ok: true });
  }

  /* ---- authenticated ---- */
  const user = await userOf(env, request);

  if (route === '/auth/logout' && m === 'POST') {
    if (user) await db(env, `DELETE FROM sessions WHERE token = ?`, [user.token]);
    return json({ ok: true });
  }
  if (route === '/auth/logout-all' && m === 'POST') {
    if (user) await db(env, `DELETE FROM sessions WHERE user_id = ?`, [user.id]);
    return json({ ok: true });
  }
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  if (route === '/auth/me' && m === 'GET') {
    const rows = await db(env, `SELECT COUNT(*) FROM emis WHERE uid = ? AND deleted = 0`, [user.id]);
    return json({ ok: true, user, counts: { emis: rows[0][0] } });
  }

  /* ---- sync: one pipeline = upserts (LWW) + pull ---- */
  if (route === '/sync' && (m === 'GET' || m === 'POST')) {
    await initSchema(env);
    let cursor = Number(url.searchParams.get('cursor') || 0);
    const stmts = [];
    if (m === 'POST') {
      const b = await readBody(request);
      if (Number.isFinite(b.cursor)) cursor = Number(b.cursor);
      const changes = Array.isArray(b.changes) ? b.changes.slice(0, 200) : [];
      for (const c of changes) {
        if (!c || typeof c.id !== 'string' || c.id.length > 64) continue;
        let payload = null;
        try { payload = JSON.stringify(c.json); } catch { continue; }
        if (payload.length > 60000) continue;
        stmts.push([`INSERT INTO emis (id, uid, json, updated_at, deleted) VALUES (?,?,?,?,?)
                      ON CONFLICT(uid,id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, deleted = excluded.deleted
                      WHERE excluded.updated_at >= emis.updated_at`,
          [c.id, user.id, payload, Number(c.updated_at) || Date.now(), c.deleted ? 1 : 0]]);
      }
    }
    stmts.push([`SELECT id, json, updated_at, deleted FROM emis WHERE uid = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`, [user.id, cursor]]);
    stmts.push([`SELECT MAX(updated_at) FROM emis WHERE uid = ?`, [user.id]]);
    const res = await pipeline(env, stmts);
    const pullRows = res[res.length - 2] || [];
    const maxRow = res[res.length - 1] || [[]];
    return json({
      ok: true,
      cursor: Number((maxRow[0] && maxRow[0][0]) || cursor) || cursor,
      changes: pullRows.map(([id, js, ua, del]) => ({ id, json: JSON.parse(js), updated_at: Number(ua), deleted: Number(del) === 1 })),
      serverTime: Date.now(),
    });
  }

  if (route === '/meta' && (m === 'GET' || m === 'POST')) {
    await initSchema(env);
    if (m === 'POST') {
      const b = await readBody(request);
      const payload = JSON.stringify(b.json || {}).slice(0, 60000);
      await db(env, `INSERT INTO meta (uid, json, updated_at) VALUES (?,?,?)
                     ON CONFLICT(uid) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`, [user.id, payload, Date.now()]);
    }
    const rows = await db(env, `SELECT json FROM meta WHERE uid = ?`, [user.id]);
    return json({ ok: true, json: rows.length ? JSON.parse(rows[0][0]) : null });
  }

  if (route === '/payments' && m === 'POST') {
    const b = await readBody(request);
    await db(env, `INSERT INTO payments (uid, emi_id, amt, at) VALUES (?,?,?,?)`, [user.id, String(b.emiId || '').slice(0, 64), Number(b.amt) || 0, Date.now()]);
    return json({ ok: true }, 201);
  }

  if (route === '/account/export' && m === 'GET') {
    const res = await pipeline(env, [
      [`SELECT id, json, updated_at, deleted FROM emis WHERE uid = ?`, [user.id]],
      [`SELECT json FROM meta WHERE uid = ?`, [user.id]],
    ]);
    const dump = {
      exported_at: new Date().toISOString(), app: 'EMIFlow',
      user: { email: user.email, name: user.name, created_at: user.created_at },
      emis: (res[0] || []).map(([id, js, ua, del]) => ({ id, json: JSON.parse(js), updated_at: ua, deleted: del })),
      meta: res[1] && res[1].length ? JSON.parse(res[1][0][0]) : null,
    };
    return new Response(JSON.stringify(dump, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="emiflow-export-${Date.now()}.json"` } });
  }

  if (route === '/account/delete' && m === 'POST') {
    const b = await readBody(request);
    const rows = await db(env, `SELECT salt, pass_hash FROM users WHERE id = ?`, [user.id]);
    if (!rows.length || (await hashPassword(String(b.password || ''), rows[0][0])) !== rows[0][1])
      return json({ ok: false, error: 'bad_credentials' }, 403);
    await pipeline(env, [
      [`DELETE FROM emis WHERE uid = ?`, [user.id]],
      [`DELETE FROM meta WHERE uid = ?`, [user.id]],
      [`DELETE FROM payments WHERE uid = ?`, [user.id]],
      [`DELETE FROM sessions WHERE user_id = ?`, [user.id]],
      [`DELETE FROM users WHERE id = ?`, [user.id]],
    ]);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
