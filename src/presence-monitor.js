const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const database = require('./database');
const { t } = require('./i18n');
const { PERMISSIONS, hasPermission, isGuildOwner } = require('./permissions');

const SETTING_KEY = 'presence_monitor';
const REFRESH_INTERVAL_MS = 5 * 60_000;
const VALID_ACCESS_MODES = new Set(['permission', 'owner', 'nobody', 'everyone']);

function getConfiguration(guildId) {
  return database.getGuildSetting(guildId, SETTING_KEY) || {
    channelId: null,
    userIds: [],
    accessMode: 'owner',
    messageId: null,
    language: 'fr',
    onlineSince: {}
  };
}

function statusDetails(guild, userId, configuration, now) {
  const presence = guild.presences.cache.get(userId);
  const status = ['online', 'idle', 'dnd'].includes(presence?.status) ? presence.status : 'offline';
  const onlineSince = { ...(configuration.onlineSince || {}) };
  if (status === 'offline') delete onlineSince[userId];
  else if (!Number.isInteger(onlineSince[userId])) onlineSince[userId] = Math.floor(now / 1000);

  const activity = presence?.activities
    ?.map(item => item.state || item.name)
    .filter(Boolean)
    .join(', ')
    .slice(0, 400);
  return { status, activity, onlineSince };
}

function makePayload(guild, configuration, now = Date.now()) {
  const language = configuration.language === 'en' ? 'en' : 'fr';
  const ids = [...new Set((configuration.userIds || []).filter(id => typeof id === 'string'))].slice(0, 5);
  const states = new Map();
  const fields = ids.map(userId => {
    const state = statusDetails(guild, userId, configuration, now);
    states.set(userId, state);
    const emoji = { online: '🟢', idle: '🌙', dnd: '⛔', offline: '⚫' }[state.status];
    const statusText = t(language, `presence_status_${state.status}`);
    const activity = state.activity || t(language, 'presence_no_activity');
    const onlineDuration = state.status === 'offline'
      ? t(language, 'presence_not_online')
      : `${t(language, 'presence_online_since')} <t:${state.onlineSince[userId]}:R>`;
    return {
      name: `<@${userId}>`,
      value: `${emoji} **${statusText}**\n${t(language, 'presence_activity')}: ${activity}\n${onlineDuration}`,
      inline: false
    };
  });
  const updatedAt = Math.floor(now / 1000);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(t(language, 'presence_title'))
    .setDescription(`${t(language, 'presence_description')}\n${t(language, 'presence_updated')} <t:${updatedAt}:R>.`)
    .addFields(...fields);
  const refresh = new ButtonBuilder()
    .setCustomId(`presence:refresh:${guild.id}`)
    .setLabel(t(language, 'presence_refresh'))
    .setStyle(ButtonStyle.Primary)
    .setDisabled(configuration.accessMode === 'nobody');
  return {
    payload: { embeds: [embed], components: [new ActionRowBuilder().addComponents(refresh)], allowedMentions: { parse: [] } },
    onlineSince: Object.fromEntries(ids.flatMap(userId => {
      const state = states.get(userId);
      return state.status === 'offline' ? [] : [[userId, state.onlineSince[userId]]];
    }))
  };
}

function persistOnlineSince(guild, configuration, now = Date.now()) {
  const result = makePayload(guild, configuration, now);
  if (JSON.stringify(result.onlineSince) !== JSON.stringify(configuration.onlineSince || {})) {
    configuration.onlineSince = result.onlineSince;
    database.setGuildSetting(guild.id, SETTING_KEY, configuration);
  }
  return result.payload;
}

function recordPresenceUpdate(guild, presence) {
  if (!guild || !presence?.userId) return;
  const configuration = getConfiguration(guild.id);
  if (!configuration.userIds?.includes(presence.userId)) return;
  const onlineSince = { ...(configuration.onlineSince || {}) };
  const status = ['online', 'idle', 'dnd'].includes(presence.status) ? presence.status : 'offline';
  if (status === 'offline') delete onlineSince[presence.userId];
  else if (!Number.isInteger(onlineSince[presence.userId])) onlineSince[presence.userId] = Math.floor(Date.now() / 1000);
  if (JSON.stringify(onlineSince) === JSON.stringify(configuration.onlineSince || {})) return;
  configuration.onlineSince = onlineSince;
  database.setGuildSetting(guild.id, SETTING_KEY, configuration);
}

async function updatePublishedMessage(client, guildId) {
  const configuration = getConfiguration(guildId);
  if (!configuration.channelId || !configuration.userIds?.length) return null;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;
  const payload = persistOnlineSince(guild, configuration);
  const channel = guild.channels.cache.get(configuration.channelId)
    || await guild.channels.fetch(configuration.channelId);
  if (!channel?.isTextBased() || typeof channel.send !== 'function') {
    throw new Error(`Presence monitor channel ${configuration.channelId} is not a sendable text channel.`);
  }
  let message;
  if (configuration.messageId) {
    try {
      message = await channel.messages.fetch(configuration.messageId);
    } catch (error) {
      if (error.code !== 10008) throw error;
    }
  }
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    configuration.messageId = message.id;
    database.setGuildSetting(guildId, SETTING_KEY, configuration);
  }
  return message;
}

async function configure(client, guildId, updates) {
  const existing = getConfiguration(guildId);
  const channelId = updates.channelId || null;
  const userIds = [...new Set((updates.userIds || []).filter(id => typeof id === 'string'))].slice(0, 5);
  const accessMode = VALID_ACCESS_MODES.has(updates.accessMode) ? updates.accessMode : 'owner';
  if (channelId && userIds.length) {
    if (existing.channelId && existing.channelId !== channelId && existing.messageId) {
      const guild = client.guilds.cache.get(guildId);
      const oldChannel = guild?.channels.cache.get(existing.channelId)
        || await guild?.channels.fetch(existing.channelId);
      if (oldChannel?.messages) {
        try {
          const oldMessage = await oldChannel.messages.fetch(existing.messageId);
          await oldMessage.delete();
        } catch (error) {
          if (error.code !== 10008) throw error;
        }
      }
    }
    const configuration = {
      ...existing,
      channelId,
      userIds,
      accessMode,
      language: updates.language === 'en' ? 'en' : 'fr',
      onlineSince: Object.fromEntries(userIds.filter(id => Number.isInteger(existing.onlineSince?.[id])).map(id => [id, existing.onlineSince[id]]))
    };
    database.setGuildSetting(guildId, SETTING_KEY, configuration);
    return updatePublishedMessage(client, guildId);
  }

  if (existing.channelId && existing.messageId) {
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(existing.channelId)
      || await guild?.channels.fetch(existing.channelId);
    if (channel?.messages) {
      try {
        const message = await channel.messages.fetch(existing.messageId);
        await message.delete();
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }
  }
  database.setGuildSetting(guildId, SETTING_KEY, {
    ...existing,
    channelId,
    userIds,
    accessMode,
    messageId: null,
    onlineSince: {}
  });
  return null;
}

function canRefresh(interaction, configuration = getConfiguration(interaction.guildId)) {
  if (isGuildOwner(interaction)) return true;
  if (configuration.accessMode === 'everyone') return true;
  if (configuration.accessMode === 'permission') return hasPermission(interaction, PERMISSIONS.VIEW_PRESENCE);
  return false;
}

async function refreshInteraction(interaction) {
  const configuration = getConfiguration(interaction.guildId);
  if (!canRefresh(interaction, configuration)) {
    const language = database.getUser(interaction.user.id).language;
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'presence_access_denied'))],
      flags: MessageFlags.Ephemeral
    });
  }
  const result = makePayload(interaction.guild, configuration);
  configuration.messageId = interaction.message?.id || configuration.messageId;
  configuration.onlineSince = result.onlineSince;
  database.setGuildSetting(interaction.guildId, SETTING_KEY, configuration);
  return interaction.update(result.payload);
}

function start(client, logger) {
  const publishConfigured = () => {
    for (const [guildId] of client.guilds.cache) {
      updatePublishedMessage(client, guildId).catch(error => logger.error('Could not update presence monitor', error.stack || error.message));
    }
  };
  const delay = REFRESH_INTERVAL_MS - (Date.now() % REFRESH_INTERVAL_MS);
  const initial = setTimeout(() => {
    publishConfigured();
    const interval = setInterval(publishConfigured, REFRESH_INTERVAL_MS);
    interval.unref();
  }, delay);
  initial.unref();
  client.on('presenceUpdate', (oldPresence, newPresence) => {
    recordPresenceUpdate(newPresence.guild, newPresence);
  });
  publishConfigured();
}

module.exports = {
  REFRESH_INTERVAL_MS,
  SETTING_KEY,
  VALID_ACCESS_MODES,
  canRefresh,
  configure,
  getConfiguration,
  makePayload,
  persistOnlineSince,
  recordPresenceUpdate,
  refreshInteraction,
  start,
  updatePublishedMessage
};
