const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const database = require('../src/database');
const presenceMonitor = require('../src/presence-monitor');
const panels = require('../src/panels');
const { PERMISSIONS } = require('../src/permissions');
const { handleInteraction, interactionCooldowns } = require('../src/interactions');

test('builds one embed for at most five members with status, activity, and online duration', () => {
  const guildId = `presence-guild-${randomUUID()}`;
  const userIds = Array.from({ length: 6 }, (_, index) => `presence-user-${index}-${randomUUID()}`);
  const configuration = {
    userIds,
    accessMode: 'permission',
    language: 'en',
    onlineSince: { [userIds[0]]: 1_000 }
  };
  const guild = {
    id: guildId,
    members: {
      cache: new Map([
        [userIds[0], { displayName: 'First member' }],
        [userIds[1], { displayName: 'Second member' }],
        [userIds[2], { displayName: 'Third member' }]
      ])
    },
    presences: {
      cache: new Map([
        [userIds[0], { status: 'online', activities: [{ name: 'Playing a game' }] }],
        [userIds[1], { status: 'idle', activities: [] }],
        [userIds[2], { status: 'dnd', activities: [] }]
      ])
    }
  };

  try {
    const result = presenceMonitor.makePayload(guild, configuration, 2_000_000);
    const embed = result.payload.embeds[0].toJSON();
    assert.equal(embed.fields.length, 5);
    assert.match(embed.title, /Server presence/);
    assert.equal(embed.fields[0].name, 'First member');
    assert.match(embed.fields[0].value, /First observed online <t:1000:R>/);
    assert.match(embed.fields[0].value, /Playing a game/);
    assert.match(embed.fields[1].value, /Idle/);
    assert.match(embed.fields[2].value, /Do Not Disturb/);
    assert.match(embed.fields[3].value, /Offline/);
    assert.equal(embed.fields[3].name, 'Unknown member');
    assert.ok(embed.fields.every(field => !field.name.includes('<@')));
    assert.match(embed.description, /duration starts when Utils first observes a member online/);
    assert.deepEqual(result.onlineSince, {
      [userIds[0]]: 1_000,
      [userIds[1]]: 2_000,
      [userIds[2]]: 2_000
    });
    assert.equal(result.payload.components[0].components[0].data.custom_id, `presence:refresh:${guildId}`);
    assert.deepEqual(result.payload.allowedMentions, { parse: [] });
  } finally {
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('persists monitor configuration, access mode, and online timestamps in the guild database', () => {
  const guildId = `presence-settings-${randomUUID()}`;
  const configuration = {
    channelId: 'channel-id',
    userIds: ['member-a', 'member-b'],
    accessMode: 'everyone',
    messageId: 'message-id',
    onlineSince: { 'member-a': 123 },
    language: 'fr'
  };

  try {
    database.setGuildSetting(guildId, presenceMonitor.SETTING_KEY, configuration);
    assert.deepEqual(presenceMonitor.getConfiguration(guildId), configuration);
    assert.equal(presenceMonitor.REFRESH_INTERVAL_MS, 5 * 60_000);
  } finally {
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('tracks the first online transition, preserves it while idle, and clears it when offline', () => {
  const guildId = `presence-events-${randomUUID()}`;
  const memberId = `presence-event-member-${randomUUID()}`;
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    database.setGuildSetting(guildId, presenceMonitor.SETTING_KEY, {
      channelId: 'channel-id',
      userIds: [memberId],
      accessMode: 'owner',
      messageId: 'message-id',
      onlineSince: {},
      language: 'en'
    });
    presenceMonitor.recordPresenceUpdate({ id: guildId }, { userId: memberId, status: 'online' });
    assert.equal(presenceMonitor.getConfiguration(guildId).onlineSince[memberId], 1_000);
    now += 30_000;
    presenceMonitor.recordPresenceUpdate({ id: guildId }, { userId: memberId, status: 'idle' });
    assert.equal(presenceMonitor.getConfiguration(guildId).onlineSince[memberId], 1_000);
    presenceMonitor.recordPresenceUpdate({ id: guildId }, { userId: memberId, status: 'offline' });
    assert.equal(Object.hasOwn(presenceMonitor.getConfiguration(guildId).onlineSince, memberId), false);
  } finally {
    Date.now = originalNow;
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('publishes one persistent message and edits it on subsequent refreshes', async () => {
  const guildId = `presence-publish-${randomUUID()}`;
  const sent = [];
  const edited = [];
  let fetchCount = 0;
  const message = {
    id: 'presence-message',
    edit: async payload => edited.push(payload),
    delete: async () => {}
  };
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      sent.push(payload);
      return message;
    },
    messages: {
      fetch: async () => {
        fetchCount += 1;
        return message;
      }
    }
  };
  const guild = {
    id: guildId,
    channels: { cache: new Map([['presence-channel', channel]]) },
    presences: { cache: new Map([['presence-member', { status: 'online', activities: [] }]]) }
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]) } };

  try {
    database.setGuildSetting(guildId, presenceMonitor.SETTING_KEY, {
      channelId: 'presence-channel',
      userIds: ['presence-member'],
      accessMode: 'owner',
      messageId: null,
      onlineSince: {},
      language: 'en'
    });
    await presenceMonitor.updatePublishedMessage(client, guildId);
    assert.equal(sent.length, 1);
    assert.equal(presenceMonitor.getConfiguration(guildId).messageId, 'presence-message');
    await presenceMonitor.updatePublishedMessage(client, guildId);
    assert.equal(fetchCount, 1);
    assert.equal(edited.length, 1);
  } finally {
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});

test('applies all configured refresh audience modes and presents manager controls', () => {
  const ownerId = `presence-owner-${randomUUID()}`;
  const memberId = `presence-member-${randomUUID()}`;
  const guildId = `presence-access-${randomUUID()}`;
  const originalHasPermission = database.hasPermission;
  database.hasPermission = (_guildId, _userId, permission, roleIds) =>
    permission === PERMISSIONS.VIEW_PRESENCE && roleIds.includes('presence-reader-role');
  const makeInteraction = (userId, roleIds = []) => ({
    user: { id: userId },
    guildId,
    guild: { ownerId },
    member: { roles: roleIds }
  });

  try {
    presenceMonitor.setAvailable(true);
    const owner = makeInteraction(ownerId);
    const member = makeInteraction(memberId);
    const permittedMember = makeInteraction(memberId, ['presence-reader-role']);
    assert.equal(presenceMonitor.canRefresh(owner, { accessMode: 'nobody' }), false);
    assert.equal(presenceMonitor.canRefresh(member, { accessMode: 'owner' }), false);
    assert.equal(presenceMonitor.canRefresh(member, { accessMode: 'nobody' }), false);
    assert.equal(presenceMonitor.canRefresh(member, { accessMode: 'everyone' }), true);
    assert.equal(presenceMonitor.canRefresh(member, { accessMode: 'permission' }), false);
    assert.equal(presenceMonitor.canRefresh(permittedMember, { accessMode: 'permission' }), true);

    const controls = panels.presenceSettingsPayload(owner, {
      channelId: 'channel-id',
      userIds: ['member-a', 'member-b'],
      accessMode: 'permission'
    });
    const components = controls.components.flatMap(row => row.components);
    const members = components.find(component => component.data.custom_id === `presence:members:${ownerId}`);
    const access = components.find(component => component.data.custom_id === `presence:access:${ownerId}`);
    assert.equal(members.data.max_values, 5);
    assert.equal(members.data.default_values.length, 2);
    assert.deepEqual(access.options.map(option => option.data.value), ['permission', 'owner', 'nobody', 'everyone']);
    assert.equal(controls.embeds.length, 1);
  } finally {
    presenceMonitor.setAvailable(false);
    database.hasPermission = originalHasPermission;
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
    database.deleteUserData(ownerId);
    database.deleteUserData(memberId);
  }
});

test('routes the manager settings panel through channel, member, access, and publish selections', async () => {
  const ownerId = `presence-config-owner-${randomUUID()}`;
  const guildId = `presence-config-guild-${randomUUID()}`;
  const memberId = `presence-config-member-${randomUUID()}`;
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const sent = [];
  const channel = {
    isTextBased: () => true,
    send: async payload => {
      sent.push(payload);
      return { id: 'published-presence-message' };
    },
    messages: { fetch: async () => ({ edit: async () => {}, delete: async () => {} }) }
  };
  const guild = {
    id: guildId,
    ownerId,
    channels: {
      cache: new Map([['monitor-channel', channel]]),
      fetch: async () => channel
    },
    presences: { cache: new Map([[memberId, { status: 'online', activities: [] }]]) }
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]) }, commands: new Map() };
  const makeInteraction = (customId, componentType, values = []) => ({
    customId,
    values,
    user: { id: ownerId },
    guildId,
    guild,
    client,
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isButton: () => componentType === 'button',
    isStringSelectMenu: () => componentType === 'string',
    isUserSelectMenu: () => componentType === 'user',
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => componentType === 'channel',
    isRepliable: () => true,
    deferUpdate: async () => {},
    editReply: async () => {},
    reply: async () => {}
  });

  try {
    presenceMonitor.setAvailable(true);
    database.setUserPreferences(ownerId, { language: 'en' });
    await handleInteraction(client, makeInteraction(`manage:presence:${ownerId}`, 'button'));
    now += 1_001;
    await handleInteraction(client, makeInteraction(`presence:channel:${ownerId}`, 'channel', ['monitor-channel']));
    now += 1_001;
    await handleInteraction(client, makeInteraction(`presence:members:${ownerId}`, 'user', [memberId]));
    now += 1_001;
    await handleInteraction(client, makeInteraction(`presence:access:${ownerId}`, 'string', ['everyone']));
    now += 1_001;
    await handleInteraction(client, makeInteraction(`presence:save:${ownerId}`, 'button'));

    const config = presenceMonitor.getConfiguration(guildId);
    assert.equal(config.channelId, 'monitor-channel');
    assert.deepEqual(config.userIds, [memberId]);
    assert.equal(config.accessMode, 'everyone');
    assert.equal(config.messageId, 'published-presence-message');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].embeds.length, 1);
  } finally {
    presenceMonitor.setAvailable(false);
    Date.now = originalNow;
    interactionCooldowns.delete(ownerId);
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
    database.deleteUserData(ownerId);
  }
});

test('removes a previously published message when presence monitoring is paused', async () => {
  const guildId = `presence-pause-${randomUUID()}`;
  let deleted = 0;
  const message = { delete: async () => { deleted += 1; } };
  const channel = { messages: { fetch: async () => message } };
  const guild = {
    id: guildId,
    channels: { cache: new Map([['presence-channel', channel]]) }
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]) } };
  const logger = { warn: assert.fail };

  try {
    database.setGuildSetting(guildId, presenceMonitor.SETTING_KEY, {
      channelId: 'presence-channel',
      userIds: ['tracked-member'],
      accessMode: 'owner',
      messageId: 'presence-message',
      onlineSince: {},
      language: 'en'
    });
    presenceMonitor.setAvailable(true);
    await presenceMonitor.pause(client, logger);
    assert.equal(deleted, 1);
    assert.equal(presenceMonitor.isAvailable(), false);
    assert.equal(presenceMonitor.getConfiguration(guildId).messageId, null);
  } finally {
    presenceMonitor.setAvailable(false);
    database.closeAll();
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
  }
});
