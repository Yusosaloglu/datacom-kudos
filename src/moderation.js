'use strict';

function listHiddenKudos(database) {
  return database.prepare(`
    SELECT
      kudos.id,
      kudos.message,
      kudos.created_at AS createdAt,
      kudos.moderated_at AS moderatedAt,
      kudos.reason_for_moderation AS moderationReason,
      sender.id AS senderId,
      sender.name AS senderName,
      recipient.id AS recipientId,
      recipient.name AS recipientName,
      moderator.name AS moderatorName
    FROM kudos
    JOIN users AS sender ON sender.id = kudos.sender_id
    JOIN users AS recipient ON recipient.id = kudos.recipient_id
    LEFT JOIN users AS moderator ON moderator.id = kudos.moderated_by
    WHERE kudos.is_visible = 0
    ORDER BY kudos.moderated_at DESC, kudos.id DESC
    LIMIT 50
  `).all();
}

function updateVisibility(database, moderator, kudosId, requestBody) {
  const id = Number(kudosId);
  const isVisible = requestBody.isVisible;
  const reason = typeof requestBody.reason === 'string'
    ? requestBody.reason.trim()
    : '';

  if (!Number.isInteger(id) || id < 1) {
    return { status: 400, error: 'A valid kudos ID is required.' };
  }

  if (typeof isVisible !== 'boolean') {
    return { status: 400, error: 'isVisible must be true or false.' };
  }

  // A reason is mandatory when hiding. It is optional when restoring.
  if (!isVisible && (reason.length < 3 || reason.length > 200)) {
    return {
      status: 400,
      error: 'Provide a moderation reason between 3 and 200 characters.'
    };
  }

  if (isVisible && reason.length > 200) {
    return {
      status: 400,
      error: 'The restoration note cannot exceed 200 characters.'
    };
  }

  const existing = database.prepare(`
    SELECT id, is_visible AS isVisible
    FROM kudos
    WHERE id = ?
  `).get(id);

  if (!existing) {
    return { status: 404, error: 'Kudos not found.' };
  }

  const nextVisibility = isVisible ? 1 : 0;
  if (existing.isVisible === nextVisibility) {
    return {
      status: 409,
      error: isVisible ? 'This kudos is already visible.' : 'This kudos is already hidden.'
    };
  }

  const action = isVisible ? 'restore' : 'hide';

  database.exec('BEGIN;');
  try {
    database.prepare(`
      UPDATE kudos
      SET
        is_visible = ?,
        moderated_by = ?,
        moderated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        reason_for_moderation = ?
      WHERE id = ?
    `).run(
      nextVisibility,
      moderator.id,
      isVisible ? null : reason,
      id
    );

    database.prepare(`
      INSERT INTO moderation_audit
        (kudos_id, action, moderator_id, reason)
      VALUES (?, ?, ?, ?)
    `).run(id, action, moderator.id, reason || null);

    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }

  return { status: 200, action };
}

function deleteKudos(database, moderator, kudosId, requestBody) {
  const id = Number(kudosId);
  const reason = typeof requestBody.reason === 'string'
    ? requestBody.reason.trim()
    : '';

  if (!Number.isInteger(id) || id < 1) {
    return { status: 400, error: 'A valid kudos ID is required.' };
  }

  if (reason.length < 3 || reason.length > 200) {
    return {
      status: 400,
      error: 'Provide a deletion reason between 3 and 200 characters.'
    };
  }

  const existing = database.prepare('SELECT id FROM kudos WHERE id = ?').get(id);
  if (!existing) {
    return { status: 404, error: 'Kudos not found.' };
  }

  database.exec('BEGIN;');
  try {
    database.prepare(`
      INSERT INTO moderation_audit
        (kudos_id, action, moderator_id, reason)
      VALUES (?, 'delete', ?, ?)
    `).run(id, moderator.id, reason);

    database.prepare('DELETE FROM kudos WHERE id = ?').run(id);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }

  return { status: 200, action: 'delete' };
}

module.exports = {
  deleteKudos,
  listHiddenKudos,
  updateVisibility
};
