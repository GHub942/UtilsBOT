const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const timestamp = require('../src/commands/timestamp');
const { beginDeletionConfirmation, cancelLanguage, confirmLanguage, finishDeletionConfirmation, handleInteraction, journalFilters, pendingDeletions, pendingLanguages, previewLanguage } = require('../src/interactions');

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
    assert.match(calls[1][1].content, /Permission statistiques requise/);
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
    assert.deepEqual(prompt.embeds, []);
    assert.match(prompt.content, /<t:\d+:R>/);
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
    assert.match(edits[0].content, /<t:\d+:R>/);
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

  try {
    database.setUserPreferences(userId, { language: 'en' });
    database.hasPermission = () => false;
    database.deleteUserData = () => { deleted = true; };
    await beginDeletionConfirmation(interaction, 'managed-user-data', 'target-user');
    const customId = responses.at(-1).components[0].components[0].data.custom_id;
    await finishDeletionConfirmation(interaction, 'confirm', customId.split(':')[2]);
    assert.equal(deleted, false);
    assert.match(responses.at(-1).content, /permission/i);
    assert.equal(pendingDeletions.has(`${guildId}:${userId}`), false);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
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
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(journalFilters.get(`${guildId}:${userId}`), {
      users: [],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.match(responses[0].embeds[0].data.description, /timestamp\.create, convert\.create/);

    interaction.customId = `journal:users:${userId}`;
    interaction.values = ['member-a', 'member-b'];
    await handleInteraction({ commands: new Map() }, interaction);
    assert.deepEqual(journalFilters.get(`${guildId}:${userId}`), {
      users: ['member-a', 'member-b'],
      actions: ['timestamp.create', 'convert.create']
    });
    assert.match(responses[1].embeds[0].data.description, /<@member-a>, <@member-b>/);
  } finally {
    database.hasPermission = originalHasPermission;
    journalFilters.delete(`${guildId}:${userId}`);
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
