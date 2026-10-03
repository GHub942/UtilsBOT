const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('registers only the dashboard slash command', () => {
  const commandsPath = path.join(__dirname, '..', 'src', 'commands');
  const commands = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .map(file => require(path.join(commandsPath, file)))
    .filter(command => command.data)
    .map(command => command.data.name);

  assert.deepEqual(commands, ['dashboard']);
});
