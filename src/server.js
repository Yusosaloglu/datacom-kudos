'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSession,
  deleteSession,
  expiredSessionCookie,
  findSessionUser,
  sessionCookie
} = require('./auth');
const { openDatabase } = require('./database');
const { createKudos, listPublicKudos } = require('./kudos');
const {
  deleteKudos,
  listHiddenKudos,
  updateVisibility
} = require('./moderation');

const PUBLIC_DIRECTORY = path.join(__dirname, '..', 'public');

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, response) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) {
    sendJson(response, 415, { error: 'Content-Type must be application/json.' });
    return null;
  }

  let rawBody = '';
  for await (const chunk of request) {
    rawBody += chunk;
    if (rawBody.length > 20_000) {
      sendJson(response, 413, { error: 'Request body is too large.' });
      return null;
    }
  }

  try {
    return JSON.parse(rawBody || '{}');
  } catch {
    sendJson(response, 400, { error: 'Request body must contain valid JSON.' });
    return null;
  }
}

function requireUser(request, response, database) {
  const user = findSessionUser(request, database);

  if (!user) {
    sendJson(response, 401, { error: 'Please sign in to continue.' });
    return null;
  }

  return user;
}

function requireAdmin(request, response, database) {
  const user = requireUser(request, response, database);
  if (!user) return null;

  if (user.role !== 'admin') {
    sendJson(response, 403, { error: 'Administrator access is required.' });
    return null;
  }

  return user;
}

function hasValidOrigin(request) {
  const origin = request.headers.origin;

  // Non-browser clients such as health monitors and command-line tools may not
  // send Origin. Browsers do send it for JSON mutation requests.
  if (!origin) return true;

  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const protocol = forwardedProtocol
    ? forwardedProtocol.split(',')[0].trim()
    : request.socket.encrypted ? 'https' : 'http';
  const expectedOrigin = `${protocol}://${request.headers.host}`;

  return origin === expectedOrigin;
}

function servePublicFile(response, requestPath) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const absolutePath = path.resolve(PUBLIC_DIRECTORY, relativePath);

  // Prevent paths such as /../src/database.js from escaping public/.
  if (!absolutePath.startsWith(`${PUBLIC_DIRECTORY}${path.sep}`)) return false;
  if (!fs.existsSync(absolutePath)) return false;
  if (!fs.statSync(absolutePath).isFile()) return false;

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };

  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(absolutePath)]
      || 'application/octet-stream',
    // During local development every refresh should revalidate changed files.
    // A production build can use versioned filenames with long-lived caching.
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(absolutePath).pipe(response);
  return true;
}

function createServer(options = {}) {
  const database = openDatabase(options.databasePath);

  const server = http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    );

    try {
      const mutatingMethods = new Set(['POST', 'PATCH', 'DELETE']);
      if (mutatingMethods.has(request.method) && !hasValidOrigin(request)) {
        return sendJson(response, 403, {
          error: 'Cross-origin requests are not allowed.'
        });
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }

      if (request.method === 'POST' && url.pathname === '/api/login') {
        const body = await readJson(request, response);
        if (!body) return;

        const user = database.prepare(`
          SELECT id, name, email, role
          FROM users
          WHERE id = ? AND is_active = 1
        `).get(Number(body.userId));

        if (!user) {
          return sendJson(response, 401, { error: 'That demo user is unavailable.' });
        }

        const token = createSession(user.id);
        return sendJson(response, 200, { user }, {
          'Set-Cookie': sessionCookie(token)
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/logout') {
        deleteSession(request);
        return sendJson(response, 200, { ok: true }, {
          'Set-Cookie': expiredSessionCookie()
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/me') {
        const user = requireUser(request, response, database);
        if (!user) return;
        return sendJson(response, 200, { user });
      }

      if (request.method === 'GET' && url.pathname === '/api/users') {
        const currentUser = requireUser(request, response, database);
        if (!currentUser) return;

        const users = database.prepare(`
          SELECT id, name
          FROM users
          WHERE is_active = 1 AND id <> ?
          ORDER BY name
        `).all(currentUser.id);

        return sendJson(response, 200, { users });
      }

      if (request.method === 'POST' && url.pathname === '/api/kudos') {
        const sender = requireUser(request, response, database);
        if (!sender) return;

        const body = await readJson(request, response);
        if (!body) return;

        const result = createKudos(database, sender, body);

        if (result.error) {
          return sendJson(response, result.status, { error: result.error });
        }

        return sendJson(response, result.status, { item: result.item });
      }

      if (request.method === 'GET' && url.pathname === '/api/kudos') {
        const user = requireUser(request, response, database);
        if (!user) return;

        const page = listPublicKudos(
          database,
          url.searchParams.get('limit'),
          url.searchParams.get('offset')
        );

        return sendJson(response, 200, page);
      }

      if (
        request.method === 'GET'
        && url.pathname === '/api/admin/kudos'
        && url.searchParams.get('visibility') === 'hidden'
      ) {
        const admin = requireAdmin(request, response, database);
        if (!admin) return;

        return sendJson(response, 200, {
          items: listHiddenKudos(database)
        });
      }

      const moderationRoute = url.pathname.match(
        /^\/api\/admin\/kudos\/(\d+)$/
      );

      if (request.method === 'PATCH' && moderationRoute) {
        const admin = requireAdmin(request, response, database);
        if (!admin) return;

        const body = await readJson(request, response);
        if (!body) return;

        const result = updateVisibility(
          database,
          admin,
          moderationRoute[1],
          body
        );

        if (result.error) {
          return sendJson(response, result.status, { error: result.error });
        }

        return sendJson(response, result.status, { action: result.action });
      }

      if (request.method === 'DELETE' && moderationRoute) {
        const admin = requireAdmin(request, response, database);
        if (!admin) return;

        const body = await readJson(request, response);
        if (!body) return;

        const result = deleteKudos(
          database,
          admin,
          moderationRoute[1],
          body
        );

        if (result.error) {
          return sendJson(response, result.status, { error: result.error });
        }

        return sendJson(response, result.status, { action: result.action });
      }

      if (url.pathname.startsWith('/api/')) {
        return sendJson(response, 404, { error: 'API endpoint not found.' });
      }

      if (request.method === 'GET' && servePublicFile(response, url.pathname)) {
        return;
      }

      return sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        path: url.pathname,
        message: error.message
      }));

      if (!response.headersSent) {
        sendJson(response, 500, { error: 'An unexpected server error occurred.' });
      } else {
        response.end();
      }
    } finally {
      console.log(JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        method: request.method,
        path: url.pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt
      }));
    }
  });

  return { server, database };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server, database } = createServer();

  server.listen(port, () => {
    console.log(`Kudos server is running at http://localhost:${port}`);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received. Closing the Kudos server...`);

    server.close(() => {
      database.close();
      console.log('Kudos server stopped cleanly.');
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
  createServer,
  requireAdmin,
  requireUser,
  sendJson
};
