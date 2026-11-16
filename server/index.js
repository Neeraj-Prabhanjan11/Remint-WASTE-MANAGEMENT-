import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresDatabase } from './postgres.js';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dbPath = process.env.DB_PATH || resolve(root, 'data', 'remint.sqlite');

export const categories = ['Plastic', 'Paper', 'Metal', 'Glass', 'Organic', 'E-waste', 'Mixed'];
export const sources = ['Household', 'Apartment', 'College Campus', 'Municipality'];
export const pickupStatuses = ['Pending', 'Scheduled', 'Assigned', 'In Progress', 'Completed', 'Cancelled'];
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const authAttempts = new Map();

export function initializeDatabase(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      organization TEXT NOT NULL DEFAULT '',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pickups (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      category TEXT NOT NULL,
      estimated_quantity_kg REAL NOT NULL,
      actual_quantity_kg REAL,
      pickup_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Household',
      collector TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS waste_logs (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pickup_id INTEGER UNIQUE REFERENCES pickups(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      quantity_kg REAL NOT NULL,
      source TEXT NOT NULL,
      sorting_method TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      logged_at TEXT NOT NULL,
      recovered_kg REAL NOT NULL DEFAULT 0,
      compost_kg REAL NOT NULL DEFAULT 0,
      resource_value_inr REAL NOT NULL DEFAULT 0,
      scrap_dealer_income_inr REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS impact_factors (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      co2_per_recovered_kg REAL NOT NULL DEFAULT 1.5,
      co2_per_compost_kg REAL NOT NULL DEFAULT 0.3,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_impact_factors (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      co2_per_recovered_kg REAL NOT NULL DEFAULT 1.5,
      co2_per_compost_kg REAL NOT NULL DEFAULT 0.3,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO impact_factors (id, co2_per_recovered_kg, co2_per_compost_kg, updated_at)
      VALUES (1, 1.5, 0.3, datetime('now'));
  `);
  for (const table of ['pickups', 'waste_logs']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
    if (!columns.includes('user_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_logs_user_date ON waste_logs(user_id, logged_at);
    CREATE INDEX IF NOT EXISTS idx_pickups_user_at ON pickups(user_id, pickup_at);
    CREATE INDEX IF NOT EXISTS idx_pickups_user_status ON pickups(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at);
  `);
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}

function emailValue(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new Error('Use a password between 12 and 128 characters.');
  }
  return value;
}

function clientKey(req, action) {
  return `${action}:${req.socket.remoteAddress || 'local'}`;
}

function allowAuthAttempt(req, action, limit) {
  const now = Date.now();
  const key = clientKey(req, action);
  const current = authAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + 15 * 60 * 1000;
  }
  current.count += 1;
  authAttempts.set(key, current);
  if (authAttempts.size > 2000) {
    for (const [attemptKey, attempt] of authAttempts) if (attempt.resetAt <= now) authAttempts.delete(attemptKey);
  }
  return current.count <= limit;
}

function passwordDigest(password, salt) {
  return scryptSync(password, salt, 64).toString('base64');
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, organization: user.organization };
}

function sessionCookie(token, maxAge, crossOrigin) {
  const secure = crossOrigin || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  const sameSite = crossOrigin ? 'None' : 'Lax';
  return `remint_session=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure}`;
}

function sessionToken(req) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (bearer) return bearer[1];
  const value = req.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith('remint_session='));
  const token = value?.slice('remint_session='.length);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function authenticate(db, req) {
  const token = sessionToken(req);
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = await db.prepare(`
    SELECT u.id, u.name, u.email, u.organization
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, new Date().toISOString());
  if (!row) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return row || null;
}

async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionLifetimeMs).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), userId, expiresAt, now.toISOString());
  return token;
}

async function withTransaction(db, action) {
  if (db.transaction) return db.transaction(action);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await action(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function handleAuth(db, req, res, url, crossOrigin) {
  const method = req.method || 'GET';
  if (url.pathname === '/api/auth/me' && method === 'GET') {
    const user = await authenticate(db, req);
    return user ? json(res, 200, { user }) : json(res, 401, { error: 'Please sign in to continue.' });
  }
  if (url.pathname === '/api/auth/logout' && method === 'POST') {
    const token = sessionToken(req);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'));
    return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0, crossOrigin) });
  }
  if ((url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/login') && method === 'POST') {
    const signup = url.pathname.endsWith('/signup');
    const action = signup ? 'signup' : 'login';
    if (!allowAuthAttempt(req, action, signup ? 10 : 8)) return json(res, 429, { error: 'Too many attempts. Please wait a few minutes and try again.' });
    const body = await readBody(req);
    const email = emailValue(body.email);
    const password = passwordValue(body.password);
    let user;
    let token;
    if (signup) {
      const name = requiredText(body.name, 'Name', 100);
      const organization = typeof body.organization === 'string' ? body.organization.trim().slice(0, 120) : '';
      const userCount = (await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
      const now = new Date().toISOString();
      const salt = randomBytes(16).toString('base64');
      const passwordHash = passwordDigest(password, salt);
      const result = await withTransaction(db, async (tx) => {
        if (await tx.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
          return { conflict: true };
        }
        const inserted = await tx.prepare(`
          INSERT INTO users (name, email, organization, password_salt, password_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(name, email, organization, salt, passwordHash, now);
        const userId = Number(inserted.lastInsertRowid);
        const legacyFactors = await tx.prepare('SELECT co2_per_recovered_kg, co2_per_compost_kg FROM impact_factors WHERE id = 1').get();
        await tx.prepare(`
          INSERT INTO user_impact_factors (user_id, co2_per_recovered_kg, co2_per_compost_kg, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(userId, legacyFactors.co2_per_recovered_kg, legacyFactors.co2_per_compost_kg, now);
        if (!userCount) {
          await tx.prepare('UPDATE pickups SET user_id = ? WHERE user_id IS NULL').run(userId);
          await tx.prepare('UPDATE waste_logs SET user_id = ? WHERE user_id IS NULL').run(userId);
        }
        const session = await createSession(tx, userId);
        const account = await tx.prepare('SELECT id, name, email, organization FROM users WHERE id = ?').get(userId);
        return { account, session };
      });
      if (result.conflict) return json(res, 409, { error: 'An account with that email already exists. Try signing in instead.' });
      user = result.account;
      token = result.session;
    } else {
      const account = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const salt = account?.password_salt || 'remint-dummy-salt';
      const expected = account ? Buffer.from(account.password_hash, 'base64') : Buffer.alloc(64);
      const actual = Buffer.from(passwordDigest(password, salt), 'base64');
      if (!account || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return json(res, 401, { error: 'Email or password is incorrect.' });
      }
      user = publicUser(account);
      token = await createSession(db, user.id);
    }
    authAttempts.delete(clientKey(req, action));
    return json(res, signup ? 201 : 200, {
      user,
      ...(crossOrigin ? { sessionToken: token } : {}),
    }, { 'set-cookie': sessionCookie(token, sessionLifetimeMs / 1000, crossOrigin) });
  }
  return json(res, 404, { error: 'Authentication route not found.' });
}

function number(value, field, { required = false, min = 0 } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`${field} must be a number of at least ${min}.`);
  return parsed;
}

function dateValue(value, field) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) throw new Error(`${field} must be a valid date and time.`);
  return parsed.toISOString();
}

function requiredText(value, field, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} is required and must be ${max} characters or fewer.`);
  }
  return value.trim();
}

function validateLog(body) {
  const category = requiredText(body.category, 'Category');
  if (!categories.includes(category)) throw new Error('Choose a valid waste category.');
  const source = requiredText(body.source, 'Source');
  if (!sources.includes(source)) throw new Error('Choose a valid waste source.');
  const quantity = number(body.quantityKg, 'Quantity', { required: true, min: 0.01 });
  const recovered = number(body.recoveredKg, 'Recovered quantity');
  const compost = number(body.compostKg, 'Compost quantity');
  if (recovered + compost > quantity) throw new Error('Recovered and compost quantities cannot exceed the logged quantity.');
  return {
    category,
    quantity,
    source,
    method: requiredText(body.sortingMethod, 'Sorting method'),
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '',
    loggedAt: dateValue(body.loggedAt, 'Log date'),
    recovered,
    compost,
    resourceValue: number(body.resourceValueInr, 'Resource value'),
    dealerIncome: number(body.scrapDealerIncomeInr, 'Scrap dealer income'),
  };
}

function validatePickup(body) {
  const category = requiredText(body.category, 'Category');
  if (!categories.includes(category)) throw new Error('Choose a valid waste category.');
  const source = body.source || 'Household';
  if (!sources.includes(source)) throw new Error('Choose a valid waste source.');
  const status = body.status || 'Pending';
  if (!pickupStatuses.includes(status)) throw new Error('Choose a valid pickup status.');
  return {
    location: requiredText(body.location, 'Location'),
    category,
    source,
    estimatedQuantity: number(body.estimatedQuantityKg, 'Estimated quantity', { required: true, min: 0.01 }),
    pickupAt: dateValue(body.pickupAt, 'Pickup date'),
    collector: typeof body.collector === 'string' ? body.collector.trim().slice(0, 120) : '',
    status,
  };
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

function dateRange(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isInteger(offset) || Math.abs(offset) > 900) throw new Error('Choose a valid timezone offset.');
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  };
  if ((from && !validDate(from)) || (to && !validDate(to))) throw new Error('Choose valid calendar dates.');
  const start = from ? new Date(Date.parse(`${from}T00:00:00.000Z`) + offset * 60_000) : new Date(0);
  const end = to ? new Date(Date.parse(`${to}T23:59:59.999Z`) + offset * 60_000) : new Date('9999-12-31T23:59:59.999Z');
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) throw new Error('Choose a valid date range.');
  return [start.toISOString(), end.toISOString()];
}

async function impactReport(db, url, userId) {
  const [from, to] = dateRange(url);
  const rows = await db.prepare(`
    SELECT category, quantity_kg, recovered_kg, compost_kg, resource_value_inr, scrap_dealer_income_inr, logged_at
    FROM waste_logs WHERE user_id = ? AND logged_at BETWEEN ? AND ? ORDER BY logged_at
  `).all(userId, from, to);
  const factors = await db.prepare('SELECT co2_per_recovered_kg, co2_per_compost_kg FROM user_impact_factors WHERE user_id = ?').get(userId);
  const totalWasteKg = rows.reduce((sum, row) => sum + row.quantity_kg, 0);
  const recoveredKg = rows.reduce((sum, row) => sum + row.recovered_kg, 0);
  const compostKg = rows.reduce((sum, row) => sum + row.compost_kg, 0);
  const categoriesByName = new Map();
  const trend = new Map();
  const bucket = url.searchParams.get('period') || 'weekly';
  const offset = Number(url.searchParams.get('offset') || 0);
  for (const row of rows) {
    const category = categoriesByName.get(row.category) || { category: row.category, quantityKg: 0, recoveredKg: 0, compostKg: 0 };
    category.quantityKg += row.quantity_kg;
    category.recoveredKg += row.recovered_kg;
    category.compostKg += row.compost_kg;
    categoriesByName.set(row.category, category);
    const date = new Date(Date.parse(row.logged_at) - offset * 60_000).toISOString().slice(0, 10);
    let key = date;
    if (bucket === 'yearly') key = date.slice(0, 7);
    if (bucket === 'monthly') {
      const startOfWeek = new Date(`${date}T00:00:00.000Z`);
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() - ((startOfWeek.getUTCDay() + 6) % 7));
      key = startOfWeek.toISOString().slice(0, 10);
    }
    const point = trend.get(key) || { period: key, quantityKg: 0, divertedKg: 0 };
    point.quantityKg += row.quantity_kg;
    point.divertedKg += row.recovered_kg + row.compost_kg;
    trend.set(key, point);
  }
  return {
    from,
    to,
    totalWasteKg,
    landfillDiversionKg: recoveredKg + compostKg,
    co2AvoidedKg: recoveredKg * factors.co2_per_recovered_kg + compostKg * factors.co2_per_compost_kg,
    materialsRecoveredKg: recoveredKg,
    compostKg,
    recyclingRate: totalWasteKg ? ((recoveredKg + compostKg) / totalWasteKg) * 100 : 0,
    resourceValueInr: rows.reduce((sum, row) => sum + row.resource_value_inr, 0),
    scrapDealerIncomeInr: rows.reduce((sum, row) => sum + row.scrap_dealer_income_inr, 0),
    factors,
    categories: [...categoriesByName.values()],
    trends: [...trend.values()],
  };
}

function csvEscape(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

async function overview(db, userId) {
  const logs = await db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(quantity_kg), 0) AS quantity, COALESCE(SUM(recovered_kg + compost_kg), 0) AS diversion FROM waste_logs WHERE user_id = ?').get(userId);
  const pickups = await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'Scheduled' THEN 1 ELSE 0 END) AS scheduled, SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed FROM pickups WHERE user_id = ?").get(userId);
  const categoriesResult = await db.prepare('SELECT category, SUM(quantity_kg) AS "quantityKg", SUM(recovered_kg + compost_kg) AS "divertedKg", SUM(resource_value_inr) AS "resourceValueInr", SUM(scrap_dealer_income_inr) AS "dealerIncomeInr" FROM waste_logs WHERE user_id = ? GROUP BY category').all(userId);
  return {
    logCount: logs.count,
    totalWasteKg: logs.quantity,
    landfillDiversionKg: logs.diversion,
    pickupCount: pickups.total,
    pendingPickups: pickups.pending || 0,
    scheduledPickups: pickups.scheduled || 0,
    completedPickups: pickups.completed || 0,
    resourceValueInr: categoriesResult.reduce((sum, item) => sum + item.resourceValueInr, 0),
    scrapDealerIncomeInr: categoriesResult.reduce((sum, item) => sum + item.dealerIncomeInr, 0),
    categories: categoriesResult,
  };
}

export function createApiServer(db, { appOrigin = process.env.APP_ORIGIN || '' } = {}) {
  const allowedAppOrigin = appOrigin.replace(/\/+$/, '');
  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method || 'GET';
    const logMatch = url.pathname.match(/^\/api\/logs\/(\d+)$/);
    const pickupMatch = url.pathname.match(/^\/api\/pickups\/(\d+)$/);
    try {
      const origin = req.headers.origin;
      if (allowedAppOrigin && origin && origin !== allowedAppOrigin) {
        return json(res, 403, { error: 'This origin is not allowed to access the Remint API.' });
      }
      if (allowedAppOrigin && origin === allowedAppOrigin) {
        res.setHeader('access-control-allow-origin', allowedAppOrigin);
        res.setHeader('access-control-allow-credentials', 'true');
        res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('access-control-allow-headers', 'Content-Type, Authorization');
        res.setHeader('vary', 'Origin');
      }
      if (method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        if (!allowedAppOrigin || origin !== allowedAppOrigin) return json(res, 403, { error: 'This origin is not allowed to access the Remint API.' });
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/api/health') return json(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/auth/')) return await handleAuth(db, req, res, url, Boolean(allowedAppOrigin));
      const user = await authenticate(db, req);
      if (!user) return json(res, 401, { error: 'Please sign in to continue.' });
      if (url.pathname === '/api/overview' && method === 'GET') return json(res, 200, await overview(db, user.id));
      if (url.pathname === '/api/logs' && method === 'GET') {
        const search = (url.searchParams.get('q') || '').trim().toLowerCase();
        const category = url.searchParams.get('category') || '';
        const rows = await db.prepare(`
          SELECT l.*, p.location AS pickup_location
          FROM waste_logs l LEFT JOIN pickups p ON p.id = l.pickup_id
          WHERE l.user_id = ? AND (? = '' OR lower(l.category) LIKE ? OR lower(l.source) LIKE ? OR lower(l.description) LIKE ?)
            AND (? = '' OR l.category = ?)
          ORDER BY l.logged_at DESC, l.id DESC
        `).all(user.id, search, `%${search}%`, `%${search}%`, `%${search}%`, category, category);
        return json(res, 200, rows);
      }
      if (url.pathname === '/api/logs' && method === 'POST') {
        const log = validateLog(await readBody(req));
        const now = new Date().toISOString();
        const result = await db.prepare(`
          INSERT INTO waste_logs (user_id, category, quantity_kg, source, sorting_method, description, logged_at, recovered_kg, compost_kg, resource_value_inr, scrap_dealer_income_inr, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, log.category, log.quantity, log.source, log.method, log.description, log.loggedAt, log.recovered, log.compost, log.resourceValue, log.dealerIncome, now, now);
        return json(res, 201, await db.prepare('SELECT * FROM waste_logs WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, user.id));
      }
      if (logMatch && method === 'PUT') {
        const log = validateLog(await readBody(req));
        const result = await db.prepare(`
          UPDATE waste_logs SET category = ?, quantity_kg = ?, source = ?, sorting_method = ?, description = ?, logged_at = ?, recovered_kg = ?, compost_kg = ?, resource_value_inr = ?, scrap_dealer_income_inr = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(log.category, log.quantity, log.source, log.method, log.description, log.loggedAt, log.recovered, log.compost, log.resourceValue, log.dealerIncome, new Date().toISOString(), Number(logMatch[1]), user.id);
        if (!result.changes) return json(res, 404, { error: 'Waste record not found.' });
        return json(res, 200, await db.prepare('SELECT * FROM waste_logs WHERE id = ? AND user_id = ?').get(Number(logMatch[1]), user.id));
      }
      if (logMatch && method === 'DELETE') {
        const linked = await db.prepare('SELECT pickup_id FROM waste_logs WHERE id = ? AND user_id = ?').get(Number(logMatch[1]), user.id);
        if (!linked) return json(res, 404, { error: 'Waste record not found.' });
        if (linked?.pickup_id) return json(res, 409, { error: 'This log was created from a completed pickup. Delete the pickup to keep its history together.' });
        const result = await db.prepare('DELETE FROM waste_logs WHERE id = ? AND user_id = ?').run(Number(logMatch[1]), user.id);
        if (!result.changes) return json(res, 404, { error: 'Waste record not found.' });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/pickups' && method === 'GET') {
        const search = (url.searchParams.get('q') || '').trim().toLowerCase();
        const status = url.searchParams.get('status') || '';
        const [from, to] = dateRange(url);
        const rows = await db.prepare(`
          SELECT * FROM pickups WHERE user_id = ? AND (? = '' OR lower(location) LIKE ? OR lower(category) LIKE ? OR lower(collector) LIKE ?)
            AND (? = '' OR status = ?) AND pickup_at BETWEEN ? AND ?
          ORDER BY pickup_at DESC, id DESC
        `).all(user.id, search, `%${search}%`, `%${search}%`, `%${search}%`, status, status, from, to);
        return json(res, 200, rows);
      }
      if (url.pathname === '/api/pickups' && method === 'POST') {
        const pickup = validatePickup(await readBody(req));
        if (pickup.status === 'Completed') return json(res, 400, { error: 'A pickup must be scheduled and weighed before it can be completed.' });
        const now = new Date().toISOString();
        const result = await db.prepare(`
          INSERT INTO pickups (user_id, location, category, estimated_quantity_kg, pickup_at, source, collector, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, pickup.location, pickup.category, pickup.estimatedQuantity, pickup.pickupAt, pickup.source, pickup.collector, pickup.status, now, now);
        return json(res, 201, await db.prepare('SELECT * FROM pickups WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, user.id));
      }
      if (pickupMatch && method === 'GET') {
        const row = await db.prepare(`
          SELECT p.*, l.id AS waste_log_id FROM pickups p LEFT JOIN waste_logs l ON l.pickup_id = p.id WHERE p.id = ? AND p.user_id = ?
        `).get(Number(pickupMatch[1]), user.id);
        return row ? json(res, 200, row) : json(res, 404, { error: 'Pickup not found.' });
      }
      if (pickupMatch && method === 'PUT') {
        const id = Number(pickupMatch[1]);
        const body = await readBody(req);
        const pickup = validatePickup(body);
        const current = await db.prepare('SELECT * FROM pickups WHERE id = ? AND user_id = ?').get(id, user.id);
        if (!current) return json(res, 404, { error: 'Pickup not found.' });
        if (current.status === 'Completed') return json(res, 409, { error: 'Completed pickups are historical records. Edit the linked waste log to update recovery details.' });
        const actual = pickup.status === 'Completed' ? number(body.actualQuantityKg, 'Actual quantity', { required: true, min: 0.01 }) : null;
        const now = new Date().toISOString();
        await withTransaction(db, async (tx) => {
          await tx.prepare(`
            UPDATE pickups SET location = ?, category = ?, estimated_quantity_kg = ?, actual_quantity_kg = COALESCE(?, actual_quantity_kg), pickup_at = ?, source = ?, collector = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?
          `).run(pickup.location, pickup.category, pickup.estimatedQuantity, actual, pickup.pickupAt, pickup.source, pickup.collector, pickup.status, now, id, user.id);
          if (pickup.status === 'Completed') {
            const existing = await tx.prepare('SELECT id FROM waste_logs WHERE pickup_id = ? AND user_id = ?').get(id, user.id);
            const logData = [pickup.category, actual, pickup.source, 'Pickup weighing', `Collected at ${pickup.location}${pickup.collector ? ` by ${pickup.collector}` : ''}`, now, now];
            if (existing) {
              await tx.prepare(`
                UPDATE waste_logs SET category = ?, quantity_kg = ?, source = ?, sorting_method = ?, description = ?, logged_at = ?, updated_at = ? WHERE pickup_id = ? AND user_id = ?
              `).run(...logData, id, user.id);
            } else {
              await tx.prepare(`
                INSERT INTO waste_logs (user_id, pickup_id, category, quantity_kg, source, sorting_method, description, logged_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(user.id, id, ...logData.slice(0, 6), now, now);
            }
          }
        });
        return json(res, 200, await db.prepare('SELECT * FROM pickups WHERE id = ? AND user_id = ?').get(id, user.id));
      }
      if (pickupMatch && method === 'DELETE') {
        const result = await db.prepare('DELETE FROM pickups WHERE id = ? AND user_id = ?').run(Number(pickupMatch[1]), user.id);
        if (!result.changes) return json(res, 404, { error: 'Pickup not found.' });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/impact' && method === 'GET') return json(res, 200, await impactReport(db, url, user.id));
      if (url.pathname === '/api/impact/factors' && method === 'PUT') {
        const body = await readBody(req);
        const recoveredFactor = number(body.co2PerRecoveredKg, 'Recovered-material CO2 factor');
        const compostFactor = number(body.co2PerCompostKg, 'Compost CO2 factor');
        if (recoveredFactor > 20 || compostFactor > 20) return json(res, 400, { error: 'Factors must be between 0 and 20 kg CO₂ per kg.' });
        await db.prepare('UPDATE user_impact_factors SET co2_per_recovered_kg = ?, co2_per_compost_kg = ?, updated_at = ? WHERE user_id = ?').run(recoveredFactor, compostFactor, new Date().toISOString(), user.id);
        return json(res, 200, await db.prepare('SELECT co2_per_recovered_kg AS "co2PerRecoveredKg", co2_per_compost_kg AS "co2PerCompostKg" FROM user_impact_factors WHERE user_id = ?').get(user.id));
      }
      if (url.pathname === '/api/impact/export.csv' && method === 'GET') {
        const rows = await db.prepare(`
          SELECT category, quantity_kg, recovered_kg, compost_kg, resource_value_inr, scrap_dealer_income_inr, logged_at, source, sorting_method
          FROM waste_logs WHERE user_id = ? AND logged_at BETWEEN ? AND ? ORDER BY logged_at
        `).all(user.id, ...dateRange(url));
        const head = ['Date', 'Category', 'Source', 'Quantity (kg)', 'Recovered (kg)', 'Compost (kg)', 'Resource value (INR)', 'Scrap dealer income (INR)', 'Sorting method'];
        const csv = [head, ...rows.map((row) => [row.logged_at, row.category, row.source, row.quantity_kg, row.recovered_kg, row.compost_kg, row.resource_value_inr, row.scrap_dealer_income_inr, row.sorting_method])]
          .map((row) => row.map(csvEscape).join(',')).join('\r\n');
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="remint-impact-${url.searchParams.get('from') || 'all'}-to-${url.searchParams.get('to') || 'all'}.csv"`,
        });
        res.end(csv);
        return;
      }
      return json(res, 404, { error: 'API route not found.' });
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 400);
      return json(res, status, { error: error.message || 'The request could not be completed.' });
    }
  };
  return createServer((req, res) => {
    if (req.url?.startsWith('/api/')) return void handle(req, res);
    serveApp(req, res);
  });
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function serveApp(req, res) {
  const dist = resolve(root, 'dist');
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const requested = resolve(dist, `.${pathname}`);
  if (requested.startsWith(`${dist}${sep}`) && existsSync(requested)) {
    try {
      const file = await readFile(requested);
      res.writeHead(200, { 'content-type': mimeTypes[extname(requested)] || 'application/octet-stream' });
      res.end(file);
      return;
    } catch (error) {
      res.writeHead(500);
      res.end('Could not read the requested app file.');
      return;
    }
  }
  try {
    const html = await readFile(resolve(dist, 'index.html'));
    res.writeHead(200, { 'content-type': mimeTypes['.html'] });
    res.end(html);
  } catch {
    json(res, 503, { error: 'The production app has not been built. Run npm run build.' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const start = async () => {
    let db;
    if (process.env.DATABASE_URL) {
      db = createPostgresDatabase(process.env.DATABASE_URL);
      try {
        await db.query(await readFile(resolve(root, 'supabase', 'schema.sql'), 'utf8'));
      } catch (error) {
        await db.close();
        throw error;
      }
    } else {
      mkdirSync(dirname(dbPath), { recursive: true });
      db = new DatabaseSync(dbPath);
      initializeDatabase(db);
    }

    const server = createApiServer(db);
    const port = Number(process.env.PORT || 4179);
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => console.log(`Remint server listening on ${host}:${port}`));
    const shutdown = () => {
      server.close(() => {
        if (db.close) db.close();
        else void db.close();
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  };
  start().catch((error) => {
    console.error('Could not start the Remint API:', error);
    process.exitCode = 1;
  });
}
