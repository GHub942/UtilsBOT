const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { MESSAGES } = require('../src/i18n');

test('keeps French and English translation keys aligned and resolves every literal translation reference', () => {
  assert.deepEqual(
    Object.keys(MESSAGES.fr).filter(key => !(key in MESSAGES.en)),
    []
  );
  assert.deepEqual(
    Object.keys(MESSAGES.en).filter(key => !(key in MESSAGES.fr)),
    []
  );

  const sourceRoot = path.join(__dirname, '..', 'src');
  const sourceFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.endsWith('.js')) sourceFiles.push(file);
    }
  }
  visit(sourceRoot);

  const missing = [];
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\([^,\n]+,\s*'([^']+)'\s*\)/g)) {
      if (!(match[1] in MESSAGES.fr)) missing.push(`${path.relative(sourceRoot, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
