const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { AUTOMATIC_UTC_ZONE, isSelectableZone, seasonalUtcGmt, storedTimeZone } = require('./time');

const DATA_ROOT = path.join(__dirname, '..', 'data');
const AUDIT_RETENTION_DAYS = 180;
const AUDIT_MAX_ENTRIES = 10000;
const AUDIT_ACTIONS = [
  'convert.create',
  'guild.export',
  'guild.reset',
  'journal.export',
  'permission.grant',
  'permission.revoke',
  'timestamp.create',
  'user.delete',
  'user.export'
];
const guildDatabases = new Map();
const userDatabases = new Map();

function validateIdentifier(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Database identifier contains invalid characters.');
}

function closeAll() {
  for (const database of [...guildDatabases.values(), ...userDatabases.values()]) database.close();
  guildDatabases.clear();
  userDatabases.clear();
}

function openDatabase(scope, id) {
  validateIdentifier(id);
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
      if (schemaVersion < 2) database.exec('CREATE TABLE IF NOT EXISTS role_permissions (role_id TEXT NOT NULL, permission TEXT NOT NULL, granted_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (role_id, permission)); PRAGMA user_version = 2;');
      database.prepare('DELETE FROM audit_log WHERE created_at < ? OR id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)').run(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000, AUDIT_MAX_ENTRIES);
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
  const automaticUtcGmt = [AUTOMATIC_UTC_ZONE, 'UTC', 'GMT'].includes(values.timezone);
  const savedTimezone = automaticUtcGmt ? AUTOMATIC_UTC_ZONE : isSelectableZone(values.timezone) ? values.timezone : 'Europe/Paris';
  return {
    timezone: automaticUtcGmt ? seasonalUtcGmt() : savedTimezone,
    automaticUtcGmt,
    language: values.language === 'en' ? 'en' : 'fr',
    isoDates: values.isoDates ?? false,
    dateFormats: values.dateFormats || ['DMY'],
    timeFormats: values.timeFormats || ['HMS'],
    dateSeparator: values.dateSeparator || '/',
    timeSeparator: values.timeSeparator || ':',
    showSeconds: values.showSeconds ?? true
  };
}

function setUserPreferences(userId, preferences) {
  const database = openDatabase('user', userId);
  const statement = database.prepare('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(preferences)) {
    if (key === 'timezone' && !isSelectableZone(value)) throw new Error('Invalid time-zone preference.');
    const storedValue = key === 'timezone' ? storedTimeZone(value) : value;
    statement.run(key, JSON.stringify(storedValue));
  }
  return getUser(userId);
}

function addAudit(guildId, action, actorId, details = '') {
  const database = openDatabase('guild', guildId);
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.prepare('INSERT INTO audit_log (action, actor_id, details, created_at) VALUES (?, ?, ?, ?)').run(action, actorId, details, Date.now());
    database.prepare('DELETE FROM audit_log WHERE created_at < ? OR id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)').run(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000, AUDIT_MAX_ENTRIES);
    database.exec('COMMIT;');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK;');
    throw error;
  }
}

function getPermissions(guildId) {
  const database = openDatabase('guild', guildId);
  const users = database.prepare("SELECT user_id AS subjectId, user_id AS userId, NULL AS roleId, 'user' AS subjectType, permission, granted_by AS grantedBy, created_at AS createdAt FROM permissions").all();
  const roles = database.prepare("SELECT role_id AS subjectId, NULL AS userId, role_id AS roleId, 'role' AS subjectType, permission, granted_by AS grantedBy, created_at AS createdAt FROM role_permissions").all();
  return [...users, ...roles].sort((left, right) => left.permission.localeCompare(right.permission) || left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId));
}

function hasPermission(guildId, userId, permission, roleIds = []) {
  const database = openDatabase('guild', guildId);
  if (database.prepare('SELECT 1 FROM permissions WHERE user_id = ? AND permission = ?').get(userId, permission)) return true;
  const ids = [...new Set(roleIds.filter(roleId => typeof roleId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(roleId)))];
  if (!ids.length) return false;
  return Boolean(database.prepare(`SELECT 1 FROM role_permissions WHERE permission = ? AND role_id IN (${ids.map(() => '?').join(', ')}) LIMIT 1`).get(permission, ...ids));
}

function grantPermission(guildId, userId, permission, actorId) {
  openDatabase('guild', guildId).prepare('INSERT INTO permissions (user_id, permission, granted_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, permission) DO UPDATE SET granted_by = excluded.granted_by').run(userId, permission, actorId, Date.now());
  addAudit(guildId, 'permission.grant', actorId, `${permission}:${userId}`);
}

function revokePermission(guildId, userId, permission, actorId) {
  openDatabase('guild', guildId).prepare('DELETE FROM permissions WHERE user_id = ? AND permission = ?').run(userId, permission);
  addAudit(guildId, 'permission.revoke', actorId, `${permission}:${userId}`);
}

function grantRolePermission(guildId, roleId, permission, actorId) {
  validateIdentifier(roleId);
  openDatabase('guild', guildId).prepare('INSERT INTO role_permissions (role_id, permission, granted_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(role_id, permission) DO UPDATE SET granted_by = excluded.granted_by').run(roleId, permission, actorId, Date.now());
  addAudit(guildId, 'permission.grant', actorId, `${permission}:role:${roleId}`);
}

function revokeRolePermission(guildId, roleId, permission, actorId) {
  validateIdentifier(roleId);
  openDatabase('guild', guildId).prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission = ?').run(roleId, permission);
  addAudit(guildId, 'permission.revoke', actorId, `${permission}:role:${roleId}`);
}

function deleteUserPreferences(userId) {
  validateIdentifier(userId);
  if (userDatabases.has(userId)) {
    userDatabases.get(userId).close();
    userDatabases.delete(userId);
  }
  const directory = path.join(DATA_ROOT, 'users', userId);
  fs.rmSync(directory, { recursive: true, force: true });
}

function deleteGuildUserPermissions(guildId, userId) {
  validateIdentifier(userId);
  const database = openDatabase('guild', guildId);
  database.exec('BEGIN IMMEDIATE;');
  try {
    const removed = database.prepare('DELETE FROM permissions WHERE user_id = ?').run(userId).changes;
    database.prepare('DELETE FROM audit_log WHERE actor_id = ? OR instr(details, ?) > 0').run(userId, userId);
    database.exec('COMMIT;');
    return removed;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK;');
    throw error;
  }
}

function deleteUserData(userId) {
  deleteUserPreferences(userId);
  const guildDirectory = path.join(DATA_ROOT, 'guilds');
  if (fs.existsSync(guildDirectory)) {
    for (const guildId of fs.readdirSync(guildDirectory)) {
      const guildPath = path.join(guildDirectory, guildId);
      if (!fs.statSync(guildPath).isDirectory()) continue;
      const database = openDatabase('guild', guildId);
      database.prepare('DELETE FROM permissions WHERE user_id = ?').run(userId);
      database.prepare('DELETE FROM audit_log WHERE actor_id = ? OR instr(details, ?) > 0').run(userId, userId);
    }
  }
}

function getUserPermissions(guildId, userId) {
  return openDatabase('guild', guildId)
    .prepare('SELECT permission, granted_by AS grantedBy, created_at AS createdAt FROM permissions WHERE user_id = ? ORDER BY permission')
    .all(userId);
}

function getOwnData(userId, guildId = null) {
  return {
    userId,
    preferences: getUser(userId),
    permissions: guildId ? getUserPermissions(guildId, userId) : []
  };
}

function getStats(guildId) {
  const database = openDatabase('guild', guildId);
  return { audit: database.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count };
}

function normalizeAuditFilters(filters = {}) {
  const uniqueValues = values => [...new Set(Array.isArray(values)
    ? values.filter(value => typeof value === 'string' && value.length > 0).slice(0, 25)
    : [])];
  return { users: uniqueValues(filters.users), actions: uniqueValues(filters.actions) };
}

function getAuditPage(guildId, page = 0, pageSize = 8, filters = {}) {
  const database = openDatabase('guild', guildId);
  const selected = normalizeAuditFilters(filters);
  const conditions = [];
  const parameters = [];
  if (selected.users.length) {
    conditions.push(`actor_id IN (${selected.users.map(() => '?').join(', ')})`);
    parameters.push(...selected.users);
  }
  if (selected.actions.length) {
    conditions.push(`action IN (${selected.actions.map(() => '?').join(', ')})`);
    parameters.push(...selected.actions);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const total = database.prepare(`SELECT COUNT(*) AS count FROM audit_log${where}`).get(...parameters).count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const entries = database.prepare(`SELECT action, actor_id AS actorId, details, created_at AS timestamp FROM audit_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...parameters, pageSize, safePage * pageSize);
  return { entries, page: safePage, totalPages, total, filters: selected };
}

function getAuditActions(guildId) {
  const recordedActions = openDatabase('guild', guildId)
    .prepare('SELECT DISTINCT action FROM audit_log ORDER BY action LIMIT 25')
    .all()
    .map(row => row.action);
  return [...new Set([...AUDIT_ACTIONS, ...recordedActions])].sort().slice(0, 25);
}

function exportAudit(guildId, filters = {}) {
  const selected = normalizeAuditFilters(filters);
  return { guildId, exportedAt: new Date().toISOString(), filters: selected, entries: getAuditPage(guildId, 0, AUDIT_MAX_ENTRIES, selected).entries };
}

function getUserData(guildId, userId) {
  const audit = openDatabase('guild', guildId)
    .prepare('SELECT action, actor_id AS actorId, details, created_at AS timestamp FROM audit_log WHERE actor_id = ? OR instr(details, ?) > 0 ORDER BY id DESC LIMIT 25')
    .all(userId, userId);
  return {
    userId,
    preferences: getUser(userId),
    audit
  };
}

function exportGuild(guildId) {
  return { guildId, exportedAt: new Date().toISOString(), ...getGuild(guildId) };
}

function resetGuild(guildId, actorId = 'system') {
  const database = openDatabase('guild', guildId);
  database.exec('DELETE FROM permissions; DELETE FROM role_permissions; DELETE FROM settings; DELETE FROM audit_log;');
  addAudit(guildId, 'guild.reset', actorId, 'Donnees serveur reinitialisees');
}

module.exports = {
  addAudit,
  deleteUser: deleteUserData,
  deleteGuildUserPermissions,
  deleteUserPreferences,
  deleteUserData,
  closeAll,
  exportGuild,
  exportAudit,
  getGuild,
  getPermissions,
  getStats,
  getAuditActions,
  getAuditPage,
  getUser,
  getUserData,
  getOwnData,
  getUserPermissions,
  hasPermission,
  grantPermission,
  grantRolePermission,
  revokePermission,
  revokeRolePermission,
  resetGuild,
  setUserPreferences,
  updateUser: setUserPreferences,
  AUDIT_MAX_ENTRIES,
  AUDIT_RETENTION_DAYS
};
