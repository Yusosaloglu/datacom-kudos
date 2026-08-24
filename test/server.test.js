'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');
const { resetRateLimits } = require('../src/kudos');

let application;
let baseUrl;

test.before(async () => {
  application = createServer({ databasePath: ':memory:' });

  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(0, '127.0.0.1', resolve);
  });

  const address = application.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(() => {
  resetRateLimits();
});

test.after(async () => {
  await new Promise((resolve) => application.server.close(resolve));
  application.database.close();
});

async function request(path, options = {}) {
  const headers = { ...options.headers };
  let body;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (options.cookie) headers.Cookie = options.cookie;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body
  });

  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function login(userId) {
  const response = await request('/api/login', {
    method: 'POST',
    body: { userId }
  });

  assert.equal(response.status, 200);
  assert.ok(response.cookie);
  return response.cookie;
}

test('health is public, while employee APIs require authentication', async () => {
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });

  const feed = await request('/api/kudos');
  assert.equal(feed.status, 401);
  assert.equal(feed.body.error, 'Please sign in to continue.');
});

test('browser mutation requests from another origin are rejected', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { Origin: 'https://malicious.example' },
    body: { userId: 1 }
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Cross-origin requests are not allowed.');
});

test('login identifies the user and colleague list excludes them', async () => {
  const cookie = await login(1);

  const current = await request('/api/me', { cookie });
  assert.equal(current.body.user.name, 'Avery Chen');
  assert.equal(current.body.user.role, 'employee');

  const colleagues = await request('/api/users', { cookie });
  assert.equal(colleagues.status, 200);
  assert.equal(
    colleagues.body.users.some((user) => user.id === 1),
    false
  );
  assert.equal(colleagues.body.users.length, 3);
});

test('creation validates input and prevents recent duplicates', async () => {
  const cookie = await login(1);

  const selfKudos = await request('/api/kudos', {
    method: 'POST',
    cookie,
    body: { recipientId: 1, message: 'Nice work' }
  });
  assert.equal(selfKudos.status, 400);

  const tooShort = await request('/api/kudos', {
    method: 'POST',
    cookie,
    body: { recipientId: 2, message: 'x' }
  });
  assert.equal(tooShort.status, 400);

  const created = await request('/api/kudos', {
    method: 'POST',
    cookie,
    body: {
      recipientId: 2,
      message: 'Excellent support during the release!'
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.senderName, 'Avery Chen');
  assert.equal(created.body.item.recipientName, 'Jordan Patel');
  assert.equal(created.body.item.isVisible, 1);

  const duplicate = await request('/api/kudos', {
    method: 'POST',
    cookie,
    body: {
      recipientId: 2,
      message: 'Excellent support during the release!'
    }
  });
  assert.equal(duplicate.status, 409);
});

test('public feed is paginated, newest first, and excludes hidden kudos', async () => {
  const cookie = await login(2);
  const insert = application.database.prepare(`
    INSERT INTO kudos (sender_id, recipient_id, message, is_visible)
    VALUES (?, ?, ?, ?)
  `);

  insert.run(2, 3, 'Older pagination record', 1);
  insert.run(3, 2, 'Hidden pagination record', 0);
  insert.run(2, 1, 'Newest pagination record', 1);

  const firstPage = await request('/api/kudos?limit=1&offset=0', { cookie });
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.items.length, 1);
  assert.equal(firstPage.body.items[0].message, 'Newest pagination record');
  assert.equal(firstPage.body.hasMore, true);
  assert.equal(firstPage.body.nextOffset, 1);

  const visibleMessages = (
    await request('/api/kudos?limit=50&offset=0', { cookie })
  ).body.items.map((item) => item.message);
  assert.equal(visibleMessages.includes('Hidden pagination record'), false);
});

test('only an administrator can hide, restore and delete with an audit trail', async () => {
  const employeeCookie = await login(3);
  const adminCookie = await login(4);
  const created = application.database.prepare(`
    INSERT INTO kudos (sender_id, recipient_id, message)
    VALUES (3, 1, 'Moderation lifecycle record')
  `).run();
  const kudosId = Number(created.lastInsertRowid);

  const forbidden = await request(`/api/admin/kudos/${kudosId}`, {
    method: 'PATCH',
    cookie: employeeCookie,
    body: { isVisible: false, reason: 'Employee attempt' }
  });
  assert.equal(forbidden.status, 403);

  const hidden = await request(`/api/admin/kudos/${kudosId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { isVisible: false, reason: 'Needs administrator review' }
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.action, 'hide');

  const queue = await request('/api/admin/kudos?visibility=hidden', {
    cookie: adminCookie
  });
  assert.equal(queue.body.items.some((item) => item.id === kudosId), true);

  const restored = await request(`/api/admin/kudos/${kudosId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { isVisible: true }
  });
  assert.equal(restored.body.action, 'restore');

  await request(`/api/admin/kudos/${kudosId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { isVisible: false, reason: 'Confirmed policy issue' }
  });
  const deleted = await request(`/api/admin/kudos/${kudosId}`, {
    method: 'DELETE',
    cookie: adminCookie,
    body: { reason: 'Confirmed permanent deletion' }
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.action, 'delete');

  const storedKudos = application.database
    .prepare('SELECT id FROM kudos WHERE id = ?')
    .get(kudosId);
  assert.equal(storedKudos, undefined);

  const actions = application.database.prepare(`
    SELECT action
    FROM moderation_audit
    WHERE kudos_id = ?
    ORDER BY id
  `).all(kudosId).map((entry) => entry.action);
  assert.deepEqual(actions, ['hide', 'restore', 'hide', 'delete']);
});
