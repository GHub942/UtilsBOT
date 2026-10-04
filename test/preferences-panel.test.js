const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const panels = require('../src/panels');
const { ZONES } = require('../src/components');

test('renders preferences as grouped category and option select menus within Discord component row limits', () => {
  const userId = `panel-test-${randomUUID()}`;
  const interaction = { user: { id: userId } };

  try {
    const regionPage = panels.userPayload(interaction, '', 'region');
    const datePage = panels.userPayload(interaction, '', 'dates');
    const timePage = panels.userPayload(interaction, '', 'times');
    const languagePage = panels.userPayload(interaction, '', 'language');
    const privacyPage = panels.userPayload(interaction, '', 'privacy');
    const privacyDataPage = panels.userPayload(interaction, '', 'privacy-data');
    const languageOptions = panels.userPayload(interaction, '', 'language-options');
    const privacyDeletePage = panels.userPayload(interaction, '', 'privacy-delete-preferences');
    const defaultPage = panels.userPayload(interaction);
    const personalDataPage = panels.userPayload(interaction, '', 'privacy-data');
    const administratorUserData = panels.userDataPayload(interaction);

    for (const page of [regionPage, datePage, timePage, languagePage, privacyPage, privacyDataPage, languageOptions, privacyDeletePage, defaultPage, personalDataPage, administratorUserData]) {
      assert.ok(page.components.length <= 5);
      assert.ok(page.components.every(row => row.components.length <= 5));
      const customIds = page.components.flatMap(row => row.components)
        .map(component => component.data.custom_id)
        .filter(Boolean);
      assert.equal(new Set(customIds).size, customIds.length, `duplicate component custom ID in ${page.embeds?.[0]?.data.title || page.content}`);
    }
    assert.ok(regionPage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:timezone-select:${userId}`));
    assert.ok(datePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:date-mode:${userId}`));
    assert.ok(timePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:seconds:${userId}`));
    assert.ok(languagePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:settings:language:${userId}`));
    assert.ok(languagePage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:settings:privacy:${userId}`));
    assert.ok(languageOptions.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:language-preview:fr:${userId}`));
    assert.equal(defaultPage.embeds[0].data.title, '⚙️ Utils • 🤖 À propos de Utils');
    assert.equal(defaultPage.embeds[0].data.description, require('../src/i18n').MESSAGES.fr.bot_description);
    assert.ok(languageOptions.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:submenu:language:${userId}`));
    assert.ok(privacyPage.components.flatMap(row => row.components).some(component => component.data.custom_id === `user:submenu:privacy:${userId}`));
    for (const page of [privacyPage, privacyDataPage, privacyDeletePage, languageOptions]) {
      assert.equal(page.components.some(row => row.components.some(component => component.data.custom_id.startsWith(`user:category:`))), false);
    }
    for (const page of [privacyPage, privacyDataPage, privacyDeletePage]) {
      assert.equal(page.embeds.length, 1);
    }
    assert.equal(personalDataPage.embeds.length, 1);
    assert.equal(administratorUserData.embeds.length, 0);
    const zoneMenu = regionPage.components.flatMap(row => row.components).find(component => component.data.custom_id === `user:timezone-select:${userId}`);
    assert.deepEqual(zoneMenu.options.map(option => option.data.value), ['UTC', ...ZONES.map(([zone]) => zone), 'custom']);
    assert.equal(zoneMenu.options[0].data.label, 'UTC/GMT');
    assert.equal(zoneMenu.options.filter(option => option.data.label === 'UTC/GMT').length, 1);
    assert.equal(zoneMenu.options.at(-1).data.label, require('../src/i18n').MESSAGES.fr.custom_zone);
    assert.equal(regionPage.components[0].components[0].data.type, 2);
    assert.equal(datePage.components[0].components[0].data.type, 2);
  } finally {
    database.deleteUserData(userId);
    database.closeAll();
  }
});

test('offers permission delegation only to the server owner and reports non-sensitive health metrics', () => {
  const userId = `panel-owner-${randomUUID()}`;
  const guildId = `panel-guild-${randomUUID()}`;
  const makeInteraction = ownerId => ({
    user: { id: userId },
    guildId,
    guild: { ownerId },
    client: {
      ws: { ping: 18, shards: new Map([[0, {}]]) },
      guilds: { cache: new Map([['guild', { memberCount: 24 }]]) },
      commands: new Map([['dashboard', {}]]),
      isReady: () => true
    }
  });

  try {
    const ownerPage = panels.permissionsPayload(makeInteraction(userId));
    const nonOwnerPage = panels.permissionsPayload(makeInteraction('another-user'));
    assert.equal(ownerPage.components[1].components[0].data.type, 6);
    assert.equal(nonOwnerPage.components[1].components[0].data.type, 6);
    const ownerOptions = ownerPage.components[2].components[0].options.map(option => option.data.value);
    const nonOwnerOptions = nonOwnerPage.components[2].components[0].options.map(option => option.data.value);
    assert.ok(ownerOptions.includes('manage_permissions'));
    assert.equal(nonOwnerOptions.includes('manage_permissions'), false);

    const health = panels.healthPayload(makeInteraction(userId)).embeds[0].data;
    assert.equal(health.title, require('../src/i18n').MESSAGES.fr.health_title);
    assert.ok(health.fields.some(field => field.name.endsWith(require('../src/i18n').MESSAGES.fr.health_members) && field.value === '`24`'));
    assert.ok(health.fields.some(field => field.name.endsWith(require('../src/i18n').MESSAGES.fr.health_runtime)));
    assert.ok(health.fields.some(field => field.name.endsWith(require('../src/i18n').MESSAGES.fr.health_uptime) && /<t:\d+:R>/.test(field.value)));
    assert.equal(JSON.stringify(health).includes(process.env.DISCORD_TOKEN || 'secret'), false);

    database.addAudit(guildId, 'timestamp.create', userId, 'UTC');
    database.addAudit(guildId, 'convert.create', 'another-user', 'UTC -> CET');
    const journal = panels.journalPayload(makeInteraction(userId), 0, { users: [userId], actions: ['timestamp.create'] });
    const userFilter = journal.components[0].components[0].data;
    const actionFilter = journal.components[1].components[0].data;
    assert.equal(userFilter.custom_id, `journal:users:${userId}`);
    assert.equal(userFilter.min_values, 0);
    assert.equal(userFilter.max_values, 25);
    assert.equal(userFilter.default_values[0].id, userId);
    assert.equal(actionFilter.custom_id, `journal:actions:${userId}`);
    assert.equal(actionFilter.max_values > 1, true);
    assert.ok(journal.components[1].components[0].options.some(option => option.data.value === 'timestamp.create' && option.data.default));
    assert.match(journal.embeds[0].data.description, /Filter|Filtrer/);
  } finally {
    database.closeAll();
    require('node:fs').rmSync(require('node:path').join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
    database.deleteUserData(userId);
    database.closeAll();
  }
});
