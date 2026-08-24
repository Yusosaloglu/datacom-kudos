'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'kudos.db');

/**
 * Open the Kudos database, create its schema and add local demonstration users.
 * Tests can pass ":memory:" to receive a fresh database that is never saved.
 */
function openDatabase(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);

  // Foreign-key enforcement must be enabled for each SQLite connection.
  database.exec('PRAGMA foreign_keys = ON;');

  // WAL improves reliability when the server reads while another request writes.
  if (databasePath !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL;');
  }

  createSchema(database);
  seedDemoUsers(database);

  return database;
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'employee'
        CHECK (role IN ('employee', 'admin')),
      is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS kudos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      recipient_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT NOT NULL
        CHECK (length(message) BETWEEN 3 AND 500),
      is_visible INTEGER NOT NULL DEFAULT 1
        CHECK (is_visible IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT
        (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      moderated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      moderated_at TEXT,
      reason_for_moderation TEXT
        CHECK (
          reason_for_moderation IS NULL
          OR length(reason_for_moderation) BETWEEN 3 AND 200
        ),
      CHECK (sender_id <> recipient_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kudos_id INTEGER NOT NULL,
      action TEXT NOT NULL
        CHECK (action IN ('hide', 'restore', 'delete')),
      moderator_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT
        CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 200),
      created_at TEXT NOT NULL DEFAULT
        (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_kudos_public_feed
      ON kudos (is_visible, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_kudos_recent_duplicates
      ON kudos (sender_id, recipient_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_moderation_audit_kudos
      ON moderation_audit (kudos_id, created_at DESC);
  `);
}

function seedDemoUsers(database) {
  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, role)
    VALUES (?, ?, ?, ?)
  `);

  const demoUsers = [
    [1, 'Avery Chen', 'avery.chen@datacom.example', 'employee'],
    [2, 'Jordan Patel', 'jordan.patel@datacom.example', 'employee'],
    [3, 'Sam Williams', 'sam.williams@datacom.example', 'employee'],
    [4, 'Morgan Lee', 'morgan.lee@datacom.example', 'admin']
  ];

  for (const user of demoUsers) {
    insertUser.run(...user);
  }
}

if (require.main === module) {
  const databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
  const database = openDatabase(databasePath);
  const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get();

  console.log(`Database ready at ${databasePath}`);
  console.log(`Demo users available: ${userCount.count}`);

  database.close();
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  openDatabase
};
