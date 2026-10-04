const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_ROOT = path.join(__dirname, '..', 'data');
const guildDatabases = new Map();
const userDatabases = new Map();

function closeAll() {
  for (const database of [...guildDatabases.values(), ...userDatabases.values()]) database.close();
  guildDatabases.clear();
  userDatabases.clear();
}

function openDatabase(scope, id) {
  const cache = scope === 'guild' ? guildDatabases : userDatabases;
  if (cache.has(id)) return cache.get(id);
  const directory = path.join(DATA_ROOT, scope === 'guild' ? 'guilds' : 'users', id);
  fs.mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(path.join(directory, 'data.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    database.exec('BEGIN IMMEDIATE;');
    if (scope === 'guild') {
      const schemaVersion = database.prepare('PRAGMA user_version').get().user_version;
      database.exec('CREATE TABLE IF NOT EXISTS permissions (user_id TEXT NOT NULL, permission TEXT NOT NULL, granted_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, permission)); CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, actor_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
      if (schemaVersion < 1) database.exec('DROP TABLE IF EXISTS whitelist; PRAGMA user_version = 1;');
    } else {
      database.exec('CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    }
    database.exec('COMMIT;');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK;');
    database.close();
    throw error;
  }
  cache.set(id, database);
  return database;
}

function getGuild(guildId) {
  const database = openDatabase('guild', guildId);
  const settings = Object.fromEntries(database.prepare('SELECT key, value FROM settings').all().map(row => [row.key, JSON.parse(row.value)]));
  const audit = database.prepare('SELECT action, actor_id AS actorId, details, created_at AS timestamp FROM audit_log ORDER BY id DESC LIMIT 200').all();
  const permissions = getPermissions(guildId);
  return { settings, permissions, audit };
}

function getUser(userId) {
  const database = openDatabase('user', userId);
  const values = Object.fromEntries(database.prepare('SELECT key, value FROM preferences').all().map(row => [row.key, JSON.parse(row.value)]));
  return { timezone: values.timezone || 'UTC', isoDates: values.isoDates ?? false, dateFormats: values.dateFormats || ['DMY'], timeFormats: values.timeFormats || ['HMS'], dateSeparator: values.dateSeparator || '/', timeSeparator: values.timeSeparator || ':', showSeconds: values.showSeconds ?? true };
}

function setUserPreferences(userId, preferences) {
  const database = openDatabase('user', userId);
  const statement = database.prepare('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(preferences)) statement.run(key, JSON.stringify(value));
  return getUser(userId);
}

function addAudit(guildId, action, actorId, details = '') {
  openDatabase('guild', guildId).prepare('INSERT INTO audit_log (action, actor_id, details, created_at) VALUES (?, ?, ?, ?)').run(action, actorId, details, Date.now());
}

function getPermissions(guildId) {
  return openDatabase('guild', guildId).prepare('SELECT user_id AS userId, permission, granted_by AS grantedBy, created_at AS createdAt FROM permissions ORDER BY permission, user_id').all();
}

function hasPermission(guildId, userId, permission) {
  return Boolean(openDatabase('guild', guildId).prepare('SELECT 1 FROM permissions WHERE user_id = ? AND permission = ?').get(userId, permission));
}

function grantPermission(guildId, userId, permission, actorId) {
  openDatabase('guild', guildId).prepare('INSERT INTO permissions (user_id, permission, granted_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, permission) DO UPDATE SET granted_by = excluded.granted_by').run(userId, permission, actorId, Date.now());
  addAudit(guildId, 'permission.grant', actorId, `${permission}:${userId}`);
}

function revokePermission(guildId, userId, permission, actorId) {
  openDatabase('guild', guildId).prepare('DELETE FROM permissions WHERE user_id = ? AND permission = ?').run(userId, permission);
  addAudit(guildId, 'permission.revoke', actorId, `${permission}:${userId}`);
}

function deleteUserData(userId) {
  if (userDatabases.has(userId)) {
    userDatabases.get(userId).close();
    userDatabases.delete(userId);
  }
  const directory = path.join(DATA_ROOT, 'users', userId);
  fs.rmSync(directory, { recursive: true, force: true });
}

function getStats(guildId) {
  const database = openDatabase('guild', guildId);
  return { audit: database.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count };
}

function getAuditPage(guildId, page = 0, pageSize = 8) {
  const database = openDatabase('guild', guildId);
  const total = database.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const entries = database.prepare('SELECT action, actor_id AS actorId, details, created_at AS timestamp FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, safePage * pageSize);
  return { entries, page: safePage, totalPages, total };
}

function exportAudit(guildId) {
  return { guildId, exportedAt: new Date().toISOString(), entries: getAuditPage(guildId, 0, 100000).entries };
}

function getUserData(guildId, userId) {
  const guild = getGuild(guildId);
  return {
    userId,
    preferences: getUser(userId),
    audit: guild.audit.filter(entry => entry.details.includes(userId)).slice(0, 25)
  };
}

function exportGuild(guildId) {
  return { guildId, exportedAt: new Date().toISOString(), ...getGuild(guildId) };
}

function resetGuild(guildId, actorId = 'system') {
  const database = openDatabase('guild', guildId);
  database.exec('DELETE FROM permissions; DELETE FROM settings; DELETE FROM audit_log;');
  addAudit(guildId, 'guild.reset', actorId, 'Donnees serveur reinitialisees');
}

module.exports = {
  addAudit,
  deleteUser: deleteUserData,
  deleteUserData,
  closeAll,
  exportGuild,
  exportAudit,
  getGuild,
  getPermissions,
  getStats,
  getAuditPage,
  getUser,
  getUserData,
  hasPermission,
  grantPermission,
  revokePermission,
  resetGuild,
  setUserPreferences,
  updateUser: setUserPreferences
};
