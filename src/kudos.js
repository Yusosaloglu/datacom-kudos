'use strict';

const recentSubmissionAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

function checkRateLimit(senderId, now = Date.now()) {
  const previousAttempts = recentSubmissionAttempts.get(senderId) || [];
  const activeAttempts = previousAttempts.filter(
    (attemptTime) => now - attemptTime < RATE_LIMIT_WINDOW_MS
  );

  if (activeAttempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
    recentSubmissionAttempts.set(senderId, activeAttempts);
    return false;
  }

  activeAttempts.push(now);
  recentSubmissionAttempts.set(senderId, activeAttempts);
  return true;
}

function findKudosById(database, kudosId) {
  return database.prepare(`
    SELECT
      kudos.id,
      kudos.message,
      kudos.is_visible AS isVisible,
      kudos.created_at AS createdAt,
      sender.id AS senderId,
      sender.name AS senderName,
      recipient.id AS recipientId,
      recipient.name AS recipientName
    FROM kudos
    JOIN users AS sender ON sender.id = kudos.sender_id
    JOIN users AS recipient ON recipient.id = kudos.recipient_id
    WHERE kudos.id = ?
  `).get(kudosId);
}

function listPublicKudos(database, requestedLimit, requestedOffset) {
  const parsedLimit = Number(requestedLimit);
  const parsedOffset = Number(requestedOffset);

  // Defaults and upper bounds prevent accidental or malicious huge queries.
  const limit = Number.isInteger(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 50)
    : 10;
  const offset = Number.isInteger(parsedOffset)
    ? Math.max(parsedOffset, 0)
    : 0;

  // Fetching one more than requested tells us whether another page exists.
  const rows = database.prepare(`
    SELECT
      kudos.id,
      kudos.message,
      kudos.created_at AS createdAt,
      sender.id AS senderId,
      sender.name AS senderName,
      recipient.id AS recipientId,
      recipient.name AS recipientName
    FROM kudos
    JOIN users AS sender ON sender.id = kudos.sender_id
    JOIN users AS recipient ON recipient.id = kudos.recipient_id
    WHERE kudos.is_visible = 1
    ORDER BY kudos.created_at DESC, kudos.id DESC
    LIMIT ? OFFSET ?
  `).all(limit + 1, offset);

  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    nextOffset: offset + Math.min(rows.length, limit)
  };
}

function createKudos(database, sender, requestBody) {
  if (!checkRateLimit(sender.id)) {
    return {
      status: 429,
      error: 'You are sending kudos too quickly. Try again shortly.'
    };
  }

  const recipientId = Number(requestBody.recipientId);
  const message = typeof requestBody.message === 'string'
    ? requestBody.message.trim()
    : '';

  if (!Number.isInteger(recipientId) || recipientId === sender.id) {
    return {
      status: 400,
      error: 'Choose a colleague other than yourself.'
    };
  }

  if (message.length < 3 || message.length > 500) {
    return {
      status: 400,
      error: 'Message must be between 3 and 500 characters.'
    };
  }

  const recipient = database.prepare(`
    SELECT id
    FROM users
    WHERE id = ? AND is_active = 1
  `).get(recipientId);

  if (!recipient) {
    return {
      status: 400,
      error: 'The selected colleague is unavailable.'
    };
  }

  const duplicate = database.prepare(`
    SELECT id
    FROM kudos
    WHERE sender_id = ?
      AND recipient_id = ?
      AND message = ?
      AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')
    LIMIT 1
  `).get(sender.id, recipientId, message);

  if (duplicate) {
    return {
      status: 409,
      error: 'This kudos was already submitted recently.'
    };
  }

  const result = database.prepare(`
    INSERT INTO kudos (sender_id, recipient_id, message)
    VALUES (?, ?, ?)
  `).run(sender.id, recipientId, message);

  return {
    status: 201,
    item: findKudosById(database, Number(result.lastInsertRowid))
  };
}

function resetRateLimits() {
  recentSubmissionAttempts.clear();
}

module.exports = {
  createKudos,
  findKudosById,
  listPublicKudos,
  resetRateLimits
};
