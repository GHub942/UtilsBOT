const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const panels = require('../src/panels');

test('renders preferences as select menus within Discord component row limits', () => {
  const userId = `panel-test-${randomUUID()}`;
  const interaction = { user: { id: userId } };

  try {
    const primaryPage = panels.userPayload(interaction);
    const secondaryPage = panels.userPayload(interaction, '', 2);

    assert.equal(primaryPage.components.length, 5);
    assert.deepEqual(primaryPage.components.slice(0, 4).map(row => row.components[0].data.type), [3, 3, 3, 3]);
    assert.equal(secondaryPage.components.length, 4);
    assert.deepEqual(secondaryPage.components.slice(0, 3).map(row => row.components[0].data.type), [3, 3, 3]);
    assert.ok(primaryPage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:timezone-select:${userId}`));
    assert.ok(secondaryPage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:seconds:${userId}`));
  } finally {
    database.deleteUserData(userId);
    database.closeAll();
  }
});
