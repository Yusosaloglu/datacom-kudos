'use strict';

const crypto = require('node:crypto');

// Sessions are kept in memory for this local demonstration. Restarting the
// server signs everyone out. Production would use SSO and shared sessions.
const sessions = new Map();
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

function readCookies(request) {
  const cookieHeader = request.headers.cookie || '';
  const cookies = {};

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = decodeURIComponent(value);
  }

  return cookies;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');

  sessions.set(token, {
    userId,
    expiresAt: Date.now() + SESSION_LIFETIME_MS
  });

  return token;
}

function deleteSession(request) {
  const token = readCookies(request).kudos_session;
  if (token) sessions.delete(token);
}

function findSessionUser(request, database) {
  const token = readCookies(request).kudos_session;
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return database.prepare(`
    SELECT id, name, email, role
    FROM users
    WHERE id = ? AND is_active = 1
  `).get(session.userId) || null;
}

function sessionCookie(token) {
  const maxAgeSeconds = SESSION_LIFETIME_MS / 1000;
  return `kudos_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function expiredSessionCookie() {
  return 'kudos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

module.exports = {
  createSession,
  deleteSession,
  expiredSessionCookie,
  findSessionUser,
  sessionCookie
};
