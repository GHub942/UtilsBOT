const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { copyDatabaseTree } = require('../src/scripts/database');

test('backs up and restores SQLite databases through the SQLite backup API', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'utilsbot-db-test-'));
  const liveRoot = path.join(temporaryRoot, 'live');
  const backupRoot = path.join(temporaryRoot, 'backup');
  const liveDatabasePath = path.join(liveRoot, 'guilds', 'test-guild', 'data.sqlite');
  fs.mkdirSync(path.dirname(liveDatabasePath), { recursive: true });

  try {
    const database = new DatabaseSync(liveDatabasePath);
    database.exec('PRAGMA journal_mode = WAL; CREATE TABLE sample (value TEXT NOT NULL); INSERT INTO sample VALUES (\'before\');');

    assert.equal(await copyDatabaseTree(liveRoot, backupRoot), 1);
    database.exec('UPDATE sample SET value = \'after\';');
    database.close();

    assert.equal(await copyDatabaseTree(backupRoot, liveRoot), 1);
    const restoredDatabase = new DatabaseSync(liveDatabasePath);
    assert.equal(restoredDatabase.prepare('SELECT value FROM sample').get().value, 'before');
    assert.equal(restoredDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    restoredDatabase.close();
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
