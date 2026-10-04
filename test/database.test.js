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
