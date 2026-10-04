const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireProcessLock } = require('../src/process-lock');

test('allows one process to own the bot lock and rejects a second instance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-bot-lock-'));
  const lockPath = path.join(directory, 'bot.pid');
  const release = acquireProcessLock(lockPath);

  try {
    assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
    assert.throws(() => acquireProcessLock(lockPath), /already running/);
  } finally {
    release();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('removes a lock whose process no longer exists', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'utils-bot-lock-'));
  const lockPath = path.join(directory, 'bot.pid');
  fs.writeFileSync(lockPath, '2147483647\n');

  try {
    const release = acquireProcessLock(lockPath);
    assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid));
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
