import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApiServer, initializeDatabase } from '../server/index.js';

let db;
let server;
let baseUrl;
let sessionCookie;

before(async () => {
  db = new DatabaseSync(':memory:');
  initializeDatabase(db);
  server = createApiServer(db, { appOrigin: 'https://neeraj-prabhanjan11.github.io' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Remint Tester', email: 'tester@example.org', password: 'secure-test-passphrase-2026', organization: 'Chennai' }),
  });
  assert.equal(signup.status, 201);
  sessionCookie = signup.headers.get('set-cookie').split(';', 1)[0];
  assert.match(signup.headers.get('set-cookie'), /SameSite=None;.*Secure/);
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

async function api(path, options = {}, cookie = sessionCookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...options.headers, ...(cookie ? { cookie } : {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  return {
    response,
    body: contentType.includes('application/json') ? await response.json() : await response.text(),
  };
}

const jsonBody = (body) => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('GitHub Pages API access allows only the configured origin', async () => {
  const preflight = await fetch(`${baseUrl}/api/logs`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://neeraj-prabhanjan11.github.io',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type, authorization',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://neeraj-prabhanjan11.github.io');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const rejected = await fetch(`${baseUrl}/api/logs`, {
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(rejected.status, 403);
});

test('waste logs validate, persist, update overview, and delete', async () => {
  const payload = {
    category: 'Paper', quantityKg: 12, source: 'College Campus', sortingMethod: 'Separated and baled',
    description: 'Library paper', loggedAt: '2026-11-16T08:00:00.000Z',
    recoveredKg: 10, compostKg: 0, resourceValueInr: 80, scrapDealerIncomeInr: 55,
  };
  const created = await api('/api/logs', { method: 'POST', ...jsonBody(payload) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.quantity_kg, 12);
  let summary = await api('/api/overview');
  assert.equal(summary.body.totalWasteKg, 12);
  assert.equal(summary.body.landfillDiversionKg, 10);
  const updated = await api(`/api/logs/${created.body.id}`, {
    method: 'PUT',
    ...jsonBody({ ...payload, quantityKg: 14, recoveredKg: 11 }),
  });
  assert.equal(updated.response.status, 200);
  summary = await api('/api/overview');
  assert.equal(summary.body.totalWasteKg, 14);
  const removed = await api(`/api/logs/${created.body.id}`, { method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  summary = await api('/api/overview');
  assert.equal(summary.body.logCount, 0);
});

test('cross-origin clients can authenticate with the session token when cookies are unavailable', async () => {
  const origin = 'https://neeraj-prabhanjan11.github.io';
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Token Member',
      email: 'token-member@example.org',
      password: 'secure-token-passphrase-2026',
    }),
  });
  const result = await signup.json();
  assert.equal(signup.status, 201);
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);

  const headers = { origin, authorization: `Bearer ${result.sessionToken}` };
  const currentUser = await fetch(`${baseUrl}/api/auth/me`, { headers });
  assert.equal(currentUser.status, 200);
  assert.equal((await currentUser.json()).user.email, 'token-member@example.org');
  const dashboard = await fetch(`${baseUrl}/api/overview`, { headers });
  assert.equal(dashboard.status, 200);
});

test('completed pickup requires a measured weight and creates one linked waste log', async () => {
  const created = await api('/api/pickups', {
    method: 'POST',
    ...jsonBody({
      location: 'Anna Nagar, Chennai', category: 'Plastic', source: 'Apartment',
      estimatedQuantityKg: 9, pickupAt: `${dayOffset(1)}T06:00:00.000Z`, collector: 'Meena',
    }),
  });
  assert.equal(created.response.status, 201);
  const id = created.body.id;
  const completionBase = {
    location: created.body.location, category: created.body.category, source: created.body.source,
    estimatedQuantityKg: created.body.estimated_quantity_kg, pickupAt: created.body.pickup_at,
    collector: 'Meena', status: 'Completed',
  };
  const incomplete = await api(`/api/pickups/${id}`, { method: 'PUT', ...jsonBody(completionBase) });
  assert.equal(incomplete.response.status, 400);
  const completedAt = Date.now();
  const completed = await api(`/api/pickups/${id}`, {
    method: 'PUT',
    ...jsonBody({ ...completionBase, actualQuantityKg: 8.4 }),
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.actual_quantity_kg, 8.4);
  const logs = await api('/api/logs');
  const generated = logs.body.find((log) => log.pickup_id === id);
  assert.ok(generated);
  assert.equal(generated.quantity_kg, 8.4);
  assert.equal(generated.source, 'Apartment');
  assert.ok(Date.parse(generated.logged_at) >= completedAt - 1000);
  const summary = await api('/api/overview');
  assert.equal(summary.body.completedPickups, 1);
  const repeated = await api(`/api/pickups/${id}`, {
    method: 'PUT',
    ...jsonBody({ ...completionBase, actualQuantityKg: 8 }),
  });
  assert.equal(repeated.response.status, 409);
  const afterRepeated = await api('/api/logs');
  assert.equal(afterRepeated.body.filter((log) => log.pickup_id === id).length, 1);
  assert.equal(afterRepeated.body.find((log) => log.pickup_id === id).quantity_kg, 8.4);
});

test('impact uses recorded weights and configurable estimate factors; CSV exports actual rows', async () => {
  const from = dayOffset(-1);
  const to = dayOffset(1);
  const report = await api(`/api/impact?from=${from}&to=${to}&period=weekly`);
  assert.equal(report.response.status, 200);
  assert.equal(report.body.totalWasteKg, 8.4);
  assert.equal(report.body.landfillDiversionKg, 0);
  assert.equal(report.body.materialsRecoveredKg, 0);
  assert.equal(report.body.co2AvoidedKg, 0);
  const factors = await api('/api/impact/factors', {
    method: 'PUT',
    ...jsonBody({ co2PerRecoveredKg: 2, co2PerCompostKg: 0.5 }),
  });
  assert.equal(factors.response.status, 200);
  const logged = await api('/api/logs', {
    method: 'POST',
    ...jsonBody({
      category: 'Organic', quantityKg: 5, source: 'Household', sortingMethod: 'Composted',
      loggedAt: `${dayOffset(0)}T10:00:00.000Z`, recoveredKg: 0, compostKg: 4,
      resourceValueInr: 0, scrapDealerIncomeInr: 0,
    }),
  });
  assert.equal(logged.response.status, 201);
  const recalculated = await api(`/api/impact?from=${from}&to=${to}`);
  assert.equal(recalculated.body.co2AvoidedKg, 2);
  assert.ok(Math.abs(recalculated.body.recyclingRate - (4 / 13.4) * 100) < 0.0001);
  const csv = await api(`/api/impact/export.csv?from=${from}&to=${to}`);
  assert.equal(csv.response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(csv.body, /Organic,Household,5,0,4/);
});

test('linked completion history cannot be deleted independently of its pickup', async () => {
  const generated = (await api('/api/logs')).body.find((log) => log.pickup_id);
  const blocked = await api(`/api/logs/${generated.id}`, { method: 'DELETE' });
  assert.equal(blocked.response.status, 409);
  const deletedPickup = await api(`/api/pickups/${generated.pickup_id}`, { method: 'DELETE' });
  assert.equal(deletedPickup.response.status, 200);
  const history = await api('/api/logs');
  assert.ok(history.body.some((log) => log.id === generated.id && log.pickup_id === null));
});

test('pickup cancellation, rescheduling, assignment, and filters remain usable', async () => {
  const created = await api('/api/pickups', {
    method: 'POST',
    ...jsonBody({
      location: 'Mylapore, Chennai', category: 'Paper', source: 'College Campus',
      estimatedQuantityKg: 4, pickupAt: `${dayOffset(2)}T06:00:00.000Z`, collector: '',
    }),
  });
  assert.equal(created.response.status, 201);
  const changed = {
    location: 'Mylapore campus gate', category: 'Paper', source: 'College Campus',
    estimatedQuantityKg: 4, pickupAt: `${dayOffset(3)}T07:00:00.000Z`, collector: 'Kumar',
    status: 'Cancelled',
  };
  const cancelled = await api(`/api/pickups/${created.body.id}`, { method: 'PUT', ...jsonBody(changed) });
  assert.equal(cancelled.body.status, 'Cancelled');
  const rescheduled = await api(`/api/pickups/${created.body.id}`, {
    method: 'PUT',
    ...jsonBody({ ...changed, status: 'Scheduled' }),
  });
  assert.equal(rescheduled.body.status, 'Scheduled');
  assert.equal(rescheduled.body.collector, 'Kumar');
  assert.equal(rescheduled.body.pickup_at, new Date(changed.pickupAt).toISOString());
  const filtered = await api('/api/pickups?status=Scheduled&q=Mylapore');
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].id, created.body.id);
  const deleted = await api(`/api/pickups/${created.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
});

test('impact date filters include events by the selected local day', async () => {
  const previousUtcDay = dayOffset(-1);
  const log = await api('/api/logs', {
    method: 'POST',
    ...jsonBody({
      category: 'Metal', quantityKg: 1.5, source: 'Municipality', sortingMethod: 'Separated',
      loggedAt: `${previousUtcDay}T20:00:00.000Z`, recoveredKg: 1, compostKg: 0,
    }),
  });
  assert.equal(log.response.status, 201);
  const localDayReport = await api(`/api/impact?from=${dayOffset(0)}&to=${dayOffset(0)}&offset=-330`);
  assert.equal(localDayReport.body.categories.find((row) => row.category === 'Metal')?.quantityKg, 1.5);
  const deleted = await api(`/api/logs/${log.body.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
});

test('accounts persist sessions and isolate every user data set', async () => {
  const currentUser = await api('/api/auth/me');
  assert.equal(currentUser.response.status, 200);
  assert.equal(currentUser.body.user.email, 'tester@example.org');
  const wrongPassword = await api('/api/auth/login', {
    method: 'POST',
    ...jsonBody({ email: 'tester@example.org', password: 'not-the-right-password-2026' }),
  }, '');
  assert.equal(wrongPassword.response.status, 401);
  const signedIn = await api('/api/auth/login', {
    method: 'POST',
    ...jsonBody({ email: 'TESTER@example.org', password: 'secure-test-passphrase-2026' }),
  }, '');
  assert.equal(signedIn.response.status, 200);
  assert.equal(signedIn.body.user.id, currentUser.body.user.id);
  const duplicate = await api('/api/auth/signup', {
    method: 'POST',
    ...jsonBody({ name: 'Another Tester', email: 'TESTER@example.org', password: 'different-valid-passphrase' }),
  }, '');
  assert.equal(duplicate.response.status, 409);

  const secondSignup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    ...jsonBody({ name: 'Second Member', email: 'second@example.org', password: 'second-member-passphrase-2026' }),
  });
  assert.equal(secondSignup.status, 201);
  const secondCookie = secondSignup.headers.get('set-cookie').split(';', 1)[0];
  assert.equal((await api('/api/overview', {}, secondCookie)).body.logCount, 0);
  const before = (await api('/api/overview')).body;
  const secondLog = await api('/api/logs', {
    method: 'POST',
    ...jsonBody({
      category: 'Glass', quantityKg: 3, source: 'Apartment', sortingMethod: 'Separated',
      loggedAt: `${dayOffset(0)}T12:00:00.000Z`, recoveredKg: 2,
    }),
  }, secondCookie);
  assert.equal(secondLog.response.status, 201);
  assert.equal((await api('/api/logs', {}, secondCookie)).body.length, 1);
  assert.deepEqual((await api('/api/overview')).body, before);
  const logout = await api('/api/auth/logout', { method: 'POST' }, secondCookie);
  assert.equal(logout.body.ok, true);
  const expired = await api('/api/auth/me', {}, secondCookie);
  assert.equal(expired.response.status, 401);
  await api(`/api/logs/${secondLog.body.id}`, { method: 'DELETE' }, sessionCookie).then(({ response }) => assert.equal(response.status, 404));
});

test('invalid category quantities and date ranges return helpful client errors', async () => {
  const invalidLog = await api('/api/logs', {
    method: 'POST',
    ...jsonBody({
      category: 'Trash', quantityKg: 2, source: 'Household', sortingMethod: 'Mixed',
      loggedAt: '2026-11-16T08:00:00.000Z', recoveredKg: 3,
    }),
  });
  assert.equal(invalidLog.response.status, 400);
  const invalidRange = await api('/api/impact?from=2026-12-01&to=2026-11-01');
  assert.equal(invalidRange.response.status, 400);
  const invalidDate = await api('/api/impact?from=2026-02-31&to=2026-03-01');
  assert.equal(invalidDate.response.status, 400);
});
