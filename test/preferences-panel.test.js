const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const panels = require('../src/panels');

test('renders preferences as grouped category and option select menus within Discord component row limits', () => {
  const userId = `panel-test-${randomUUID()}`;
  const interaction = { user: { id: userId } };

  try {
    const regionPage = panels.userPayload(interaction, '', 'region');
    const datePage = panels.userPayload(interaction, '', 'dates');
    const timePage = panels.userPayload(interaction, '', 'times');
    const languagePage = panels.userPayload(interaction, '', 'language');

    for (const page of [regionPage, datePage, timePage, languagePage]) {
      assert.ok(page.components.length <= 5);
      assert.ok(page.components.every(row => row.components.length <= 5));
    }
    assert.ok(regionPage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:timezone-select:${userId}`));
    assert.ok(datePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:date-mode:${userId}`));
    assert.ok(timePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:seconds:${userId}`));
    assert.ok(languagePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:language:${userId}`));
    assert.equal(regionPage.components[0].components[0].data.type, 2);
    assert.equal(datePage.components[0].components[0].data.type, 2);
  } finally {
    database.deleteUserData(userId);
    database.closeAll();
  }
});
