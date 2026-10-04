const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const { PERMISSIONS } = require('../src/permissions');
const timestamp = require('../src/commands/timestamp');
const { beginDeletionConfirmation, cancelLanguage, confirmLanguage, finishDeletionConfirmation, handleInteraction, healthRefreshCooldowns, interactionCooldowns, journalFilters, pendingDeletions, pendingLanguages, pendingServerResets, previewLanguage, timezoneOrigins } = require('../src/interactions');

test('denies server statistics access without permission and responds ephemerally', async () => {
  const userId = `interaction-test-${randomUUID()}`;
  const guildId = `interaction-guild-${randomUUID()}`;
  const calls = [];
  const hasPermission = database.hasPermission;
  database.hasPermission = () => false;
  const interaction = {
    customId: `manage:stats:${userId}`,
    user: { id: userId },
    guildId,
    guild: { ownerId: 'different-owner' },
    memberPermissions: { has: () => false },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isRepliable: () => true,
    deferUpdate: async () => calls.push('deferUpdate'),
    reply: async payload => calls.push(['reply', payload]),
    followUp: async payload => calls.push(['followUp', payload])
  };

  try {
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['deferUpdate', 'followUp']);
    assert.match(calls[1][1].embeds[0].data.description, /Permission statistiques requise/);
  } finally {
    database.hasPermission = hasPermission;
  }
});

test('dispatches modal submissions to their handler without a second generic reply', async () => {
  const userId = `modal-test-${randomUUID()}`;
  const calls = [];
  const interaction = {
    customId: 'timestamp:field:date',
    user: { id: userId },
    isChatInputCommand: () => false,
    fields: { getTextInputValue: () => '31/03/2026' },
    isModalSubmit: () => true,
    deferReply: async () => calls.push('deferReply'),
    editReply: async payload => calls.push(['editReply', payload]),
    reply: async () => calls.push('reply'),
    deleteReply: async () => calls.push('deleteReply')
  };

  try {
    await handleInteraction({ commands: new Map() }, interaction);
    assert.equal(calls.filter(call => call === 'deferReply').length, 1);
    assert.equal(calls.includes('reply'), false);
    assert.equal(calls[1][0], 'editReply');
  } finally {
    timestamp.drafts.delete(userId);
    database.deleteUserData(userId);
    database.closeAll();
  }
});

test('confirms language previews, cancels them, and restores the prior language after ten seconds', async () => {
  const userId = `language-test-${randomUUID()}`;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let scheduled;
  global.setTimeout = (callback, milliseconds) => {
    scheduled = { callback, milliseconds, unref() {} };
    return scheduled;
  };
  global.clearTimeout = () => {};
  const calls = [];
  const interaction = {
    user: { id: userId },
    update: async payload => calls.push(['update', payload]),
    editReply: async payload => calls.push(['editReply', payload])
  };

  try {
    database.setUserPreferences(userId, { language: 'fr' });
    await previewLanguage(interaction, 'en');
    assert.match(calls.at(-1)[1].embeds[0].data.description, /<t:\d+:R>/);
    assert.equal(scheduled.milliseconds, 10_000);
    let customId = calls.at(-1)[1].components[0].components[0].data.custom_id;
    await cancelLanguage(interaction, customId.split(':')[2]);
    assert.equal(database.getUser(userId).language, 'fr');

    await previewLanguage(interaction, 'en');
    customId = calls.at(-1)[1].components[0].components[0].data.custom_id;
    await confirmLanguage(interaction, customId.split(':')[2]);
    assert.equal(database.getUser(userId).language, 'en');

    database.setUserPreferences(userId, { language: 'fr' });
    await previewLanguage(interaction, 'en');
    scheduled.callback();
    assert.equal(database.getUser(userId).language, 'fr');
    assert.match(calls.at(-1)[1].embeds[0].data.description, /10 secondes/);
    assert.equal(pendingLanguages.has(userId), false);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    pendingLanguages.delete(userId);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('requires a second deletion confirmation within five seconds and includes a relative deadline', async () => {
  const userId = `delete-confirm-${randomUUID()}`;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDeletePreferences = database.deleteUserPreferences;
  let scheduled;
  let deleted = false;
  const calls = [];
  const interaction = {
    user: { id: userId },
    guildId: null,
    update: async payload => calls.push(['update', payload])
  };
  global.setTimeout = (callback, milliseconds) => {
    scheduled = { callback, milliseconds, unref() {} };
    return scheduled;
  };
  global.clearTimeout = () => {};

  try {
    database.setUserPreferences(userId, { language: 'en' });
    database.deleteUserPreferences = () => { deleted = true; };
    await beginDeletionConfirmation(interaction, 'preferences');
    assert.equal(scheduled.milliseconds, 5_000);
    const prompt = calls.at(-1)[1];
    assert.equal(prompt.embeds.length, 1);
    assert.match(prompt.embeds[0].data.description, /<t:\d+:R>/);
    const customId = prompt.components[0].components[0].data.custom_id;
    await finishDeletionConfirmation(interaction, 'confirm', customId.split(':')[2]);
    assert.equal(deleted, true);
    assert.equal(pendingDeletions.has(`dm:${userId}`), false);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    database.deleteUserPreferences = originalDeletePreferences;
    pendingDeletions.delete(`dm:${userId}`);
    originalDeletePreferences(userId);
    database.closeAll();
  }
});

test('returns to the relevant confirmation screen when a deletion is cancelled', async () => {
  const userId = `delete-cancel-${randomUUID()}`;
  const managedUserId = `managed-user-${randomUUID()}`;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  const responses = [];
  global.setTimeout = (callback, milliseconds) => {
    const timer = { callback, milliseconds, unref() {} };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = () => {};
  const interaction = {
    user: { id: userId },
    guildId: `delete-cancel-guild-${randomUUID()}`,
    update: async payload => responses.push(payload)
  };

  try {
    database.setUserPreferences(userId, { language: 'en' });
    await beginDeletionConfirmation(interaction, 'preferences');
    const preferenceNonce = responses.at(-1).components[0].components[0].data.custom_id.split(':')[2];
    await finishDeletionConfirmation(interaction, 'cancel', preferenceNonce);
    assert.equal(responses.at(-1).embeds.length, 1);
    assert.ok(responses.at(-1).components.flatMap(row => row.components).some(component => component.data.custom_id === `user:delete-preferences-confirm:${userId}`));

    await beginDeletionConfirmation(interaction, 'managed-user-data', managedUserId);
    const userNonce = responses.at(-1).components[0].components[0].data.custom_id.split(':')[2];
    await finishDeletionConfirmation(interaction, 'cancel', userNonce);
    assert.ok(responses.at(-1).components.flatMap(row => row.components).some(component => component.data.custom_id === `data:delete-confirm:${userId}`));
    assert.equal(responses.at(-1).embeds.length, 1);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    pendingDeletions.delete(`${interaction.guildId}:${userId}`);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('rate limits all interactions and applies a separate three-second operational refresh cooldown', async () => {
  const userId = `cooldown-user-${randomUUID()}`;
  const guildId = `cooldown-guild-${randomUUID()}`;
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  const replies = [];
  const makeUnknown = () => ({
    customId: `unknown:${userId}`,
    user: { id: userId },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    reply: async payload => replies.push(payload)
  });
  const makeHealthRefresh = () => ({
    customId: `manage:health-refresh:${userId}`,
    user: { id: userId },
    guildId,
    guild: { ownerId: userId },
    client: {
      ws: { ping: 10, shards: new Map([[0, {}]]) },
      guilds: { cache: new Map([['guild', { memberCount: 1 }]]) },
      commands: new Map(),
      isReady: () => true
    },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    deferUpdate: async () => {},
    reply: async payload => replies.push(payload),
    followUp: async payload => replies.push(payload),
    editReply: async payload => replies.push(payload)
  });

  try {
    database.setUserPreferences(userId, { language: 'en' });
    await handleInteraction({ commands: new Map() }, makeUnknown());
    await handleInteraction({ commands: new Map() }, makeUnknown());
    assert.match(replies.at(-1).embeds[0].data.title, /Please wait/);
    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeUnknown());
    assert.equal(interactionCooldowns.has(userId), true);

    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeHealthRefresh());
    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeHealthRefresh());
    assert.match(replies.at(-1).embeds[0].data.title, /Please wait/);
    now += 2_000;
    await handleInteraction({ commands: new Map() }, makeHealthRefresh());
    assert.ok(replies.at(-1).embeds[0].data.fields.some(field => field.name.endsWith(require('../src/i18n').MESSAGES.en.health_uptime)));
  } finally {
    Date.now = originalNow;
    interactionCooldowns.delete(userId);
    healthRefreshCooldowns.delete(userId);
    database.closeAll();
    require('node:fs').rmSync(require('node:path').join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('shares the one-second cooldown across slash commands, select menus, and buttons', async () => {
  const userId = `shared-cooldown-${randomUUID()}`;
  const originalNow = Date.now;
  let now = 200_000;
  Date.now = () => now;
  const calls = [];
  const client = {
    commands: new Map([['dashboard', {
      execute: async interaction => {
        await interaction.reply({ embeds: [] });
        calls.push('command');
      }
    }]])
  };
  const makeBase = customId => ({
    customId,
    user: { id: userId },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    reply: async payload => calls.push(['reply', payload])
  });
  const command = {
    ...makeBase(),
    commandName: 'dashboard',
    isChatInputCommand: () => true,
    deferReply: async () => {},
    editReply: async () => {}
  };
  const select = {
    ...makeBase(`user:timezone-select:${userId}`),
    values: ['Europe/Paris'],
    isStringSelectMenu: () => true,
    deferUpdate: async () => calls.push('select-ack'),
    editReply: async () => calls.push('select')
  };
  const button = {
    ...makeBase(`dashboard:user:${userId}`),
    isButton: () => true,
    deferUpdate: async () => calls.push('button-ack'),
    editReply: async () => calls.push('button')
  };

  try {
    database.setUserPreferences(userId, { language: 'en' });
    await handleInteraction(client, command);
    assert.deepEqual(calls, ['command']);

    await handleInteraction(client, select);
    assert.match(calls.at(-1)[1].embeds[0].data.title, /Please wait/);
    now += 1_001;
    await handleInteraction(client, select);
    assert.equal(calls.at(-1), 'select');

    await handleInteraction(client, button);
    assert.match(calls.at(-1)[1].embeds[0].data.title, /Please wait/);
    now += 1_001;
    await handleInteraction(client, button);
    assert.equal(calls.at(-1), 'button');
  } finally {
    Date.now = originalNow;
    interactionCooldowns.delete(userId);
    timezoneOrigins.delete(userId);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('opens custom time-zone modals directly from the region select menu', async () => {
  const userId = `custom-zone-select-${randomUUID()}`;
  const originalNow = Date.now;
  let now = 300_000;
  Date.now = () => now;
  const calls = [];
  const interaction = {
    customId: `user:timezone-select:${userId}`,
    values: ['custom'],
    user: { id: userId },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    deferUpdate: async () => calls.push('incorrectly-deferred'),
    showModal: async modal => calls.push(modal)
  };

  try {
    database.setUserPreferences(userId, { language: 'en' });
    await handleInteraction({ commands: new Map() }, interaction);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data.title, require('../src/i18n').MESSAGES.en.timezone_modal_title);
    assert.equal(calls.includes('incorrectly-deferred'), false);
    assert.equal(timezoneOrigins.has(userId), true);
  } finally {
    Date.now = originalNow;
    interactionCooldowns.delete(userId);
    const pending = timezoneOrigins.get(userId);
    if (pending) clearTimeout(pending.timer);
    timezoneOrigins.delete(userId);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('expires destructive confirmations after five seconds without deleting data', async () => {
  const userId = `delete-timeout-${randomUUID()}`;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let scheduled;
  const edits = [];
  const interaction = {
    user: { id: userId },
    guildId: null,
    update: async () => {},
    editReply: async payload => edits.push(payload)
  };
  global.setTimeout = (callback, milliseconds) => {
    scheduled = { callback, milliseconds, unref() {} };
    return scheduled;
  };
  global.clearTimeout = () => {};

  try {
    database.setUserPreferences(userId, { language: 'fr' });
    await beginDeletionConfirmation(interaction, 'preferences');
    assert.equal(scheduled.milliseconds, 5_000);
    scheduled.callback();
    await Promise.resolve();
    assert.equal(pendingDeletions.has(`dm:${userId}`), false);
    assert.match(edits[0].embeds[0].data.description, /<t:\d+:R>/);
    assert.equal(edits[0].components.length, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    pendingDeletions.delete(`dm:${userId}`);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('rechecks delegated delete permission when the final confirmation is submitted', async () => {
  const userId = `delete-permission-${randomUUID()}`;
  const guildId = `delete-guild-${randomUUID()}`;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalHasPermission = database.hasPermission;
  const originalDeleteUserData = database.deleteUserData;
  const originalNow = Date.now;
  let now = originalNow();
  let scheduled;
  let deleted = false;
  const responses = [];
  const interaction = {
    user: { id: userId },
    guildId,
    guild: { ownerId: 'server-owner' },
    update: async payload => responses.push(payload)
  };
  global.setTimeout = (callback, milliseconds) => {
    scheduled = { callback, milliseconds, unref() {} };
    return scheduled;
  };
  global.clearTimeout = () => {};
  Date.now = () => now;

  try {
    database.setUserPreferences(userId, { language: 'en' });
    database.hasPermission = () => false;
    database.deleteUserData = () => { deleted = true; };
    await beginDeletionConfirmation(interaction, 'managed-user-data', 'target-user');
    const customId = responses.at(-1).components[0].components[0].data.custom_id;
    await finishDeletionConfirmation(interaction, 'confirm', customId.split(':')[2]);
    assert.equal(deleted, false);
    assert.match(responses.at(-1).embeds[0].data.description, /permission/i);
    assert.equal(pendingDeletions.has(`${guildId}:${userId}`), false);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalNow;
    database.hasPermission = originalHasPermission;
    database.deleteUserData = originalDeleteUserData;
    pendingDeletions.delete(`${guildId}:${userId}`);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('accepts multi-value journal filters and resets to the first filtered page', async () => {
  const userId = `journal-filter-${randomUUID()}`;
  const guildId = `journal-guild-${randomUUID()}`;
  const originalHasPermission = database.hasPermission;
  const originalNow = Date.now;
  let now = originalNow();
  const responses = [];
  const interaction = {
    customId: `journal:actions:${userId}`,
    values: ['timestamp.create', 'convert.create'],
    user: { id: userId },
    guildId,
    guild: { ownerId: 'server-owner' },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => false,
    isStringSelectMenu: () => interaction.customId.startsWith('journal:actions:'),
    isUserSelectMenu: () => interaction.customId.startsWith('journal:users:'),
    isRepliable: () => true,
    deferUpdate: async () => {},
    editReply: async payload => responses.push(payload)
  };

  try {
    database.hasPermission = () => true;
    Date.now = () => now;
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(journalFilters.get(`${guildId}:${userId}`), {
      users: [],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.match(responses[0].embeds[0].data.description, /timestamp\.create, convert\.create/);

    interaction.customId = `journal:users:${userId}`;
    interaction.values = ['member-a', 'member-b'];
    now += 1_000;
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(journalFilters.get(`${guildId}:${userId}`), {
      users: ['member-a', 'member-b'],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.match(responses[1].embeds[0].data.description, /<@member-a>, <@member-b>/);
  } finally {
    Date.now = originalNow;
    database.hasPermission = originalHasPermission;
    journalFilters.delete(`${guildId}:${userId}`);
    database.closeAll();
  }
});

test('routes a role select through permission grant and revoke', async () => {
  const userId = `role-manager-${randomUUID()}`;
  const guildId = `role-manager-guild-${randomUUID()}`;
  const roleId = `managed-role-${randomUUID()}`;
  const originalNow = Date.now;
  let now = originalNow();
  const calls = [];
  const makeInteraction = (customId, values = []) => ({
    customId,
    values,
    user: { id: userId },
    guildId,
    guild: { ownerId: userId },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => customId.startsWith('perm:enable:') || customId.startsWith('perm:disable:'),
    isStringSelectMenu: () => customId.startsWith('perm:type:'),
    isUserSelectMenu: () => false,
    isRoleSelectMenu: () => customId.startsWith('perm:role:'),
    isRepliable: () => true,
    deferUpdate: async () => {},
    editReply: async payload => calls.push(payload)
  });

  try {
    database.setUserPreferences(userId, { language: 'en' });
    Date.now = () => now;
    await handleInteraction({ commands: new Map() }, makeInteraction(`perm:role:${userId}`, [roleId]));
    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeInteraction(`perm:type:${userId}`, [PERMISSIONS.VIEW_STATS]));
    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeInteraction(`perm:enable:${userId}`));
    assert.equal(database.hasPermission(guildId, 'member-with-role', PERMISSIONS.VIEW_STATS, [roleId]), true);
    assert.match(calls.at(-1).embeds[0].data.fields[0].value, new RegExp(`<@&${roleId}>`));

    now += 1_000;
    await handleInteraction({ commands: new Map() }, makeInteraction(`perm:disable:${userId}`));
    assert.equal(database.hasPermission(guildId, 'member-with-role', PERMISSIONS.VIEW_STATS, [roleId]), false);
  } finally {
    Date.now = originalNow;
    database.deleteUserData(userId);
    database.closeAll();
    require('node:fs').rmSync(require('node:path').join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('resets a guild only after the reset modal contains the exact uppercase word RESET', async () => {
  const userId = `reset-confirm-${randomUUID()}`;
  const guildId = `reset-guild-${randomUUID()}`;
  const originalNow = Date.now;
  let now = originalNow();
  const originalResetGuild = database.resetGuild;
  const calls = [];
  let resetCount = 0;
  database.resetGuild = (...args) => { resetCount += 1; calls.push(['reset', ...args]); };
  const buttonInteraction = {
    customId: `db:reset-confirm:${userId}`,
    user: { id: userId },
    guildId,
    guild: { ownerId: userId },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    showModal: async modal => calls.push(['modal', modal])
  };
  const modalInteraction = customId => ({
    customId,
    user: { id: userId },
    guildId,
    guild: { ownerId: userId },
    fields: { getTextInputValue: () => 'Reset' },
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    isRepliable: () => true,
    reply: async payload => calls.push(['reply', payload])
  });

  try {
    database.setUserPreferences(userId, { language: 'en' });
    Date.now = () => now;
    await handleInteraction({ commands: new Map() }, buttonInteraction);
    const modal = calls[0][1];
    assert.equal(modal.data.title, require('../src/i18n').MESSAGES.en.server_reset_phrase_title);
    const modalId = `db:reset-modal:${pendingServerResets.keys().next().value}:${userId}`;
    now += 1_000;
    await handleInteraction({ commands: new Map() }, modalInteraction(modalId));
    assert.equal(resetCount, 0);
    assert.match(calls.at(-1)[1].embeds[0].data.title, /RESET/);
    assert.equal(pendingServerResets.size, 0);

    const secondButton = { ...buttonInteraction, showModal: async value => calls.push(['modal', value]) };
    now += 1_000;
    await handleInteraction({ commands: new Map() }, secondButton);
    const secondModalId = `db:reset-modal:${pendingServerResets.keys().next().value}:${userId}`;
    const exactInteraction = {
      ...modalInteraction(secondModalId),
      fields: { getTextInputValue: () => 'RESET' }
    };
    now += 1_000;
    await handleInteraction({ commands: new Map() }, exactInteraction);
    assert.equal(resetCount, 1);
    assert.deepEqual(calls.find(call => call[0] === 'reset').slice(1), [guildId, userId]);
  } finally {
    Date.now = originalNow;
    database.resetGuild = originalResetGuild;
    for (const pending of pendingServerResets.values()) clearTimeout(pending.timer);
    pendingServerResets.clear();
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('routes timestamp confirmation to the exported timestamp handler', async () => {
  const userId = `timestamp-route-${randomUUID()}`;
  const responses = [];
  const interaction = {
    customId: `timestamp:confirm:${userId}`,
    user: { id: userId },
    guildId: null,
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isUserSelectMenu: () => false,
    isRepliable: () => true,
    deferUpdate: async () => {},
    editReply: async payload => responses.push(payload)
  };

  try {
    timestamp.drafts.set(userId, {
      date: '04/10/2026',
      time: '13:00:00',
      zone: 'UTC',
      language: 'fr',
      dateFormats: ['DMY'],
      timeFormats: ['HMS'],
      dateSeparator: '/',
      timeSeparator: ':',
      showSeconds: true
    });
    await handleInteraction({ commands: new Map() }, interaction);
    assert.match(responses[0].embeds[0].data.title, /Timestamp créé/);
    assert.match(responses[0].embeds[0].data.fields[0].value, /04\/10\/2026 13:00:00/);
  } finally {
    timestamp.drafts.delete(userId);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});

test('stores padded date and completed seconds from timestamp form submissions', async () => {
  const userId = `timestamp-normalize-${randomUUID()}`;
  const editedPanels = [];
  const draft = {
    zone: 'Europe/Paris',
    language: 'fr',
    date: '',
    time: '',
    dateFormats: ['DMY'],
    timeFormats: ['HMS'],
    dateSeparator: '/',
    timeSeparator: ':',
    showSeconds: true,
    origin: { editReply: async payload => editedPanels.push(payload) }
  };

  try {
    timestamp.drafts.set(userId, draft);
    const makeModalInteraction = (field, value) => ({
      customId: `timestamp:field:${field}`,
      user: { id: userId },
      fields: { getTextInputValue: () => value },
      deferReply: async () => {},
      deleteReply: async () => {}
    });

    await timestamp.handleModal(makeModalInteraction('date', '4/10/26'));
    await timestamp.handleModal(makeModalInteraction('time', '13:00'));
    assert.equal(draft.date, '04/10/2026');
    assert.equal(draft.time, '13:00:00');
    assert.equal(editedPanels.length, 2);
    assert.equal(editedPanels[1].embeds[0].data.fields[1].value, '04/10/2026');
    assert.equal(editedPanels[1].embeds[0].data.fields[2].value, '13:00:00');
  } finally {
    timestamp.drafts.delete(userId);
    database.deleteUserPreferences(userId);
    database.closeAll();
  }
});
