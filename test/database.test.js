const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const database = require('../src/database');

test('drops legacy whitelist data and retains explicit permission records', () => {
  const guildId = `migration-test-${randomUUID()}`;
  const guildDirectory = path.join(__dirname, '..', 'data', 'guilds', guildId);
  const dbPath = path.join(guildDirectory, 'data.sqlite');
  fs.mkdirSync(guildDirectory, { recursive: true });

  try {
    const legacyDatabase = new DatabaseSync(dbPath);
    legacyDatabase.exec(`
      CREATE TABLE whitelist (user_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE permissions (user_id TEXT NOT NULL, permission TEXT NOT NULL, granted_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, permission));
      INSERT INTO whitelist VALUES ('legacy-user', 1);
      INSERT INTO permissions VALUES ('authorized-user', 'view_stats', 'admin', 2);
    `);
    legacyDatabase.close();

    const guild = database.getGuild(guildId);
    assert.equal(Object.hasOwn(guild, 'whitelist'), false);
    assert.deepEqual(guild.permissions.map(row => row.userId), ['authorized-user']);
    assert.equal(database.hasPermission(guildId, 'authorized-user', 'view_stats'), true);
    assert.equal(database.hasPermission(guildId, 'legacy-user', 'view_stats'), false);
    assert.equal(database.getStats(guildId).audit, 0);

    const migratedDatabase = new DatabaseSync(dbPath);
    assert.equal(migratedDatabase.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(migratedDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'whitelist'").get(), undefined);
    migratedDatabase.close();
  } finally {
    database.closeAll();
    fs.rmSync(guildDirectory, { recursive: true, force: true });
  }
});

test('deletes a user preferences, permissions, and identifying guild audit entries', () => {
  const guildId = `privacy-test-${randomUUID()}`;
  const userId = `privacy-user-${randomUUID()}`;
  const guildDirectory = path.join(__dirname, '..', 'data', 'guilds', guildId);
  const userDirectory = path.join(__dirname, '..', 'data', 'users', userId);

  try {
    database.setUserPreferences(userId, { timezone: 'Europe/Paris' });
    database.grantPermission(guildId, userId, 'view_stats', 'admin');
    database.addAudit(guildId, 'user.action', userId, 'subject=' + userId);
    assert.equal(database.getStats(guildId).audit, 2);

    database.deleteUserData(userId);

    assert.equal(database.hasPermission(guildId, userId, 'view_stats'), false);
    assert.equal(database.getStats(guildId).audit, 0);
    assert.equal(fs.existsSync(userDirectory), false);
  } finally {
    database.closeAll();
    fs.rmSync(guildDirectory, { recursive: true, force: true });
    fs.rmSync(userDirectory, { recursive: true, force: true });
  }
});

test('self-service deletion keeps preferences and only changes the current server scope', () => {
  const userId = `self-privacy-${randomUUID()}`;
  const guildId = `self-guild-${randomUUID()}`;
  const otherGuildId = `other-guild-${randomUUID()}`;
  const userDirectory = path.join(__dirname, '..', 'data', 'users', userId);
  const guildDirectories = [guildId, otherGuildId].map(id => path.join(__dirname, '..', 'data', 'guilds', id));

  try {
    database.setUserPreferences(userId, { timezone: 'UTC' });
    database.grantPermission(guildId, userId, 'view_stats', 'admin');
    database.grantPermission(otherGuildId, userId, 'view_data', 'admin');
    database.addAudit(guildId, 'user.action', userId, 'permission target');
    database.addAudit(otherGuildId, 'user.action', userId, 'permission target');
    assert.equal(database.getUser(userId).automaticUtcGmt, true);
    assert.deepEqual(database.getOwnData(userId, guildId).permissions.map(item => item.permission), ['view_stats']);

    assert.equal(database.deleteGuildUserPermissions(guildId, userId), 1);
    assert.equal(database.hasPermission(guildId, userId, 'view_stats'), false);
    assert.equal(database.hasPermission(otherGuildId, userId, 'view_data'), true);
    assert.equal(database.getStats(guildId).audit, 0);
    assert.equal(database.getStats(otherGuildId).audit, 2);

    database.deleteUserPreferences(userId);
    assert.equal(database.hasPermission(otherGuildId, userId, 'view_data'), true);
    assert.equal(fs.existsSync(userDirectory), false);
  } finally {
    database.closeAll();
    for (const directory of guildDirectories) fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(userDirectory, { recursive: true, force: true });
  }
});

test('filters paginated audit results by multiple actors and actions, and exports only matching entries', () => {
  const guildId = `audit-filter-${randomUUID()}`;
  const actorA = `actor-a-${randomUUID()}`;
  const actorB = `actor-b-${randomUUID()}`;

  try {
    database.addAudit(guildId, 'timestamp.create', actorA, 'zone=UTC');
    database.addAudit(guildId, 'convert.create', actorA, 'UTC -> CET');
    database.addAudit(guildId, 'timestamp.create', actorB, 'zone=Europe/Paris');
    database.addAudit(guildId, 'permission.grant', actorB, 'view_stats:member');

    const filtered = database.getAuditPage(guildId, 0, 8, {
      users: [actorA, actorB],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.equal(filtered.total, 3);
    assert.deepEqual(filtered.entries.map(entry => entry.action), [
      'timestamp.create',
      'convert.create',
      'timestamp.create'
    ]);
    assert.deepEqual(filtered.filters, {
      users: [actorA, actorB],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.deepEqual(database.getAuditPage(guildId, 0, 8, { users: [actorA], actions: ['permission.grant'] }).entries, []);

    const exported = database.exportAudit(guildId, { users: [actorB], actions: ['timestamp.create', 'permission.grant'] });
    assert.deepEqual(exported.entries.map(entry => entry.action), ['permission.grant', 'timestamp.create']);
    assert.deepEqual(exported.filters, { users: [actorB], actions: ['timestamp.create', 'permission.grant'] });
    assert.ok(database.getAuditActions(guildId).includes('convert.create'));
  } finally {
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});
