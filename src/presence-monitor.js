const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const database = require('./database');
const { t } = require('./i18n');
const { PERMISSIONS, hasPermission, isGuildOwner } = require('./permissions');
const logger = require('./logger');

const SETTING_KEY = 'presence_monitor';
const REFRESH_INTERVAL_MS = 5 * 60_000;
const REFRESH_USER_COOLDOWN_MS = 15_000;
const REFRESH_GLOBAL_COOLDOWN_MS = 5_000;
const VALID_ACCESS_MODES = new Set(['permission', 'owner', 'nobody', 'everyone']);
let presenceAvailable = false;
const guildRefreshes = new Map();
const userRefreshes = new Map();
const refreshEnableTimers = new Map();
const REQUIRED_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
];

function validateChannelPermissions(channel, guild) {
  if (typeof channel.permissionsFor !== 'function') return;
  const botMember = guild.members?.me;
  const permissions = botMember && channel.permissionsFor(botMember);
  if (!permissions || permissions.missing(REQUIRED_CHANNEL_PERMISSIONS).length) {
    const error = new Error('The bot is missing permissions required to publish the presence monitor.');
    error.code = 'PRESENCE_CHANNEL_MISSING_PERMISSIONS';
    throw error;
  }
}

function isAvailable() {
  return presenceAvailable;
}

function setAvailable(value) {
  presenceAvailable = Boolean(value);
}

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
  const member = guild.members?.cache?.get(userId);
  const user = member?.user || presence?.user || guild.client?.users?.cache?.get(userId);
  const status = ['online', 'idle', 'dnd', 'offline'].includes(presence?.status)
    ? presence.status
    : presence || member
      ? 'offline'
      : 'unknown';
  const onlineSince = { ...(configuration.onlineSince || {}) };
  if (status === 'offline') delete onlineSince[userId];
  else if (['online', 'idle', 'dnd'].includes(status) && !Number.isInteger(onlineSince[userId])) {
    onlineSince[userId] = Math.floor(now / 1000);
  }

  const activity = presence?.activities
    ?.map(item => item.state || item.name)
    .filter(Boolean)
    .join(', ')
    .slice(0, 400);
  return {
    status,
    activity,
    displayName: member?.displayName || user?.globalName || user?.username,
    onlineSince
  };
}

function makePayload(guild, configuration, now = Date.now()) {
  const language = configuration.language === 'en' ? 'en' : 'fr';
  const ids = [...new Set((configuration.userIds || []).filter(id => typeof id === 'string'))].slice(0, 5);
  const states = new Map();
  const fields = ids.map(userId => {
    const state = statusDetails(guild, userId, configuration, now);
    states.set(userId, state);
    const emoji = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫', unknown: '❔' }[state.status];
    const statusText = t(language, `presence_status_${state.status}`);
    const activity = state.status === 'unknown'
      ? t(language, 'presence_activity_unavailable')
      : state.activity || t(language, 'presence_no_activity');
    const onlineDuration = state.status === 'offline' || state.status === 'unknown'
      ? t(language, `presence_status_${state.status}`)
      : `${t(language, 'presence_first_seen_online')} <t:${state.onlineSince[userId]}:R>`;
    return {
      name: `${emoji} ${state.displayName || t(language, 'presence_unknown_member')}`,
      value: `<@${userId}> \`${userId}\`\n**${statusText}**\n${t(language, 'presence_activity')}: ${activity}\n${onlineDuration}`,
      inline: false
    };
  });
  const updatedAt = Math.floor(now / 1000);
  const nextUpdate = Math.ceil((Math.floor(now / REFRESH_INTERVAL_MS) + 1) * REFRESH_INTERVAL_MS / 1000);
  const guildCooldownRemaining = Math.max(0, REFRESH_GLOBAL_COOLDOWN_MS - (now - (guildRefreshes.get(guild.id) ?? -Infinity)));
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${t(language, 'presence_title')} • ${guild.name}`)
    .setDescription(`${t(language, 'presence_description')}\n${t(language, 'presence_updated')} <t:${updatedAt}:R>\n${t(language, 'presence_next_update')} <t:${nextUpdate}:R>`)
    .addFields(...fields);
  const refresh = new ButtonBuilder()
    .setCustomId(`presence:refresh:${guild.id}`)
    .setLabel(guildCooldownRemaining
      ? `${t(language, 'presence_refresh_wait')} ${Math.ceil(guildCooldownRemaining / 1000)}s`
      : t(language, 'presence_refresh'))
    .setStyle(ButtonStyle.Primary)
    .setDisabled(configuration.accessMode === 'nobody' || guildCooldownRemaining > 0);
  return {
    payload: { embeds: [embed], components: [new ActionRowBuilder().addComponents(refresh)], allowedMentions: { parse: [] } },
    onlineSince: Object.fromEntries(ids.flatMap(userId => {
      const state = states.get(userId);
      return ['online', 'idle', 'dnd'].includes(state.status) ? [[userId, state.onlineSince[userId]]] : [];
    }))
  };
}

function takeRefreshCooldown(guildId, userId, now = Date.now()) {
  const userKey = `${guildId}:${userId}`;
  const userLastRefresh = userRefreshes.get(userKey);
  const userRemaining = userLastRefresh === undefined
    ? 0
    : Math.max(0, REFRESH_USER_COOLDOWN_MS - (now - userLastRefresh));
  const guildLastRefresh = guildRefreshes.get(guildId);
  const guildRemaining = guildLastRefresh === undefined
    ? 0
    : Math.max(0, REFRESH_GLOBAL_COOLDOWN_MS - (now - guildLastRefresh));
  if (userRemaining || guildRemaining) {
    return {
      scope: userRemaining >= guildRemaining ? 'user' : 'guild',
      remainingMs: Math.max(userRemaining, guildRemaining)
    };
  }
  userRefreshes.set(userKey, now);
  guildRefreshes.set(guildId, now);
  if (userRefreshes.size > 5_000) {
    for (const [id, refreshedAt] of userRefreshes) {
      if (now - refreshedAt >= REFRESH_USER_COOLDOWN_MS) userRefreshes.delete(id);
    }
  }
  if (guildRefreshes.size > 5_000) {
    for (const [id, refreshedAt] of guildRefreshes) {
      if (now - refreshedAt >= REFRESH_GLOBAL_COOLDOWN_MS) guildRefreshes.delete(id);
    }
  }
  return null;
}

function scheduleRefreshButtonEnable(interaction, expiresAt) {
  const guildId = interaction.guildId;
  const previousTimer = refreshEnableTimers.get(guildId);
  if (previousTimer) clearTimeout(previousTimer);

  const timer = setTimeout(async () => {
    refreshEnableTimers.delete(guildId);
    const lastRefresh = guildRefreshes.get(guildId);
    if (lastRefresh !== undefined && Date.now() < lastRefresh + REFRESH_GLOBAL_COOLDOWN_MS) {
      scheduleRefreshButtonEnable(interaction, lastRefresh + REFRESH_GLOBAL_COOLDOWN_MS);
      return;
    }
    try {
      const configuration = getConfiguration(guildId);
      if (!configuration.channelId || !configuration.messageId) return;
      const language = configuration.language === 'en' ? 'en' : 'fr';
      const refresh = new ButtonBuilder()
        .setCustomId(`presence:refresh:${guildId}`)
        .setLabel(t(language, 'presence_refresh'))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(configuration.accessMode === 'nobody');
      const guild = interaction.client?.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(configuration.channelId)
        || await guild?.channels.fetch(configuration.channelId);
      const message = interaction.message?.id === configuration.messageId
        ? interaction.message
        : await channel?.messages?.fetch(configuration.messageId);
      if (!message) return;
      await message.edit({
        components: [new ActionRowBuilder().addComponents(refresh)]
      });
    } catch (error) {
      logger.warn(`Could not re-enable the presence refresh button for guild ${guildId}.`, error.stack || error.message);
    }
  }, Math.max(0, expiresAt - Date.now()));
  timer.unref();
  refreshEnableTimers.set(guildId, timer);
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
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId)
      || await guild?.channels.fetch(channelId);
    if (!guild || !channel?.isTextBased() || typeof channel.send !== 'function') {
      throw new Error(`Presence monitor channel ${channelId} is not a sendable text channel.`);
    }
    validateChannelPermissions(channel, guild);
    const configuration = {
      ...existing,
      channelId,
      userIds,
      accessMode,
      language: updates.language === 'en' ? 'en' : 'fr',
      onlineSince: Object.fromEntries(userIds.filter(id => Number.isInteger(existing.onlineSince?.[id])).map(id => [id, existing.onlineSince[id]]))
    };
    database.setGuildSetting(guildId, SETTING_KEY, configuration);
    let message;
    try {
      message = await updatePublishedMessage(client, guildId);
    } catch (error) {
      database.setGuildSetting(guildId, SETTING_KEY, existing);
      throw error;
    }
    if (existing.channelId && existing.channelId !== channelId && existing.messageId) {
      const oldChannel = guild.channels.cache.get(existing.channelId)
        || await guild.channels.fetch(existing.channelId);
      if (oldChannel?.messages) {
        try {
          const oldMessage = await oldChannel.messages.fetch(existing.messageId);
          await oldMessage.delete();
        } catch (error) {
          if (error.code === 50013) {
            logger.warn(`Could not remove the previous presence monitor message from channel ${existing.channelId} in guild ${guildId}: missing channel permissions.`);
          } else if (error.code !== 10008) throw error;
        }
      }
    }
    return message;
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
  if (configuration.accessMode === 'nobody') return false;
  if (isGuildOwner(interaction)) return true;
  if (configuration.accessMode === 'everyone') return true;
  if (configuration.accessMode === 'permission') return hasPermission(interaction, PERMISSIONS.VIEW_PRESENCE);
  return false;
}

async function refreshInteraction(interaction, now = Date.now()) {
  const configuration = getConfiguration(interaction.guildId);
  if (!canRefresh(interaction, configuration)) {
    const language = database.getUser(interaction.user.id).language;
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'presence_access_denied'))],
      flags: MessageFlags.Ephemeral
    });
  }
  const cooldown = takeRefreshCooldown(interaction.guildId, interaction.user.id, now);
  if (cooldown) {
    const language = configuration.language === 'en' ? 'en' : 'fr';
    const retryAt = Math.ceil((now + cooldown.remainingMs) / 1000);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(t(language, 'presence_refresh_cooldown'))
        .setDescription(`${t(language, cooldown.scope === 'user' ? 'presence_refresh_user_wait' : 'presence_refresh_guild_wait')} <t:${retryAt}:R>.`)],
      flags: MessageFlags.Ephemeral
    });
  }
  const result = makePayload(interaction.guild, configuration, now);
  configuration.messageId = interaction.message?.id || configuration.messageId;
  configuration.onlineSince = result.onlineSince;
  database.setGuildSetting(interaction.guildId, SETTING_KEY, configuration);
  const response = await interaction.update(result.payload);
  scheduleRefreshButtonEnable(interaction, now + REFRESH_GLOBAL_COOLDOWN_MS);
  return response;
}

function start(client, logger) {
  setAvailable(true);
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

async function pause(client, logger) {
  setAvailable(false);
  for (const [guildId] of client.guilds.cache) {
    const configuration = getConfiguration(guildId);
    if (!configuration.channelId || !configuration.messageId) continue;
    try {
      const guild = client.guilds.cache.get(guildId);
      const channel = guild.channels.cache.get(configuration.channelId)
        || await guild.channels.fetch(configuration.channelId);
      const message = await channel.messages.fetch(configuration.messageId);
      await message.delete();
      configuration.messageId = null;
      database.setGuildSetting(guildId, SETTING_KEY, configuration);
    } catch (error) {
      if (error.code === 10008) {
        configuration.messageId = null;
        database.setGuildSetting(guildId, SETTING_KEY, configuration);
        continue;
      }
      logger.warn(`Could not remove the paused presence monitor message in guild ${guildId}.`, error.stack || error.message);
    }
  }
}

module.exports = {
  REFRESH_GLOBAL_COOLDOWN_MS,
  REFRESH_INTERVAL_MS,
  REFRESH_USER_COOLDOWN_MS,
  SETTING_KEY,
  VALID_ACCESS_MODES,
  REQUIRED_CHANNEL_PERMISSIONS,
  canRefresh,
  configure,
  getConfiguration,
  isAvailable,
  makePayload,
  pause,
  persistOnlineSince,
  recordPresenceUpdate,
  refreshInteraction,
  start,
  setAvailable,
  scheduleRefreshButtonEnable,
  takeRefreshCooldown,
  updatePublishedMessage
};
