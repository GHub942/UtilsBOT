const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } = require('discord.js');
const { randomUUID } = require('node:crypto');
const dashboard = require('./commands/dashboard');
const timestamp = require('./commands/timestamp');
const convert = require('./commands/convert');
const panels = require('./panels');
const database = require('./database');
const { isSelectableZone } = require('./time');
const { PERMISSIONS, PERMISSION_LABELS, canManagePermission, canOpenServerDashboard, grantPermission, grantRolePermission, hasPermission, revokePermission, revokeRolePermission } = require('./permissions');
const { acknowledgeCommand, acknowledgeComponent } = require('./interaction-responses');
const { t } = require('./i18n');
const logger = require('./logger');
const presenceMonitor = require('./presence-monitor');

const selections = new Map();
const journalFilters = new Map();
const pendingLanguages = new Map();
const pendingDeletions = new Map();
const pendingServerResets = new Map();
const interactionCooldowns = new Map();
const healthRefreshCooldowns = new Map();
const timezoneOrigins = new Map();
const INTERACTION_COOLDOWN_MS = 1_000;
const HEALTH_REFRESH_COOLDOWN_MS = 3_000;

function cancelPendingLanguage(userId) {
  const pending = pendingLanguages.get(userId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingLanguages.delete(userId);
}

function owns(customId, userId) { return customId.split(':').at(-1) === userId; }
function selectionKey(interaction) { return `${interaction.guildId || 'dm'}:${interaction.user.id}`; }
function getJournalFilters(interaction) {
  return journalFilters.get(selectionKey(interaction)) || { users: [], actions: [] };
}
function deletionKey(interaction) { return `${interaction.guildId || 'dm'}:${interaction.user.id}`; }
function manager(interaction, permission) { return hasPermission(interaction, permission); }
function updateSettings(userId, update) { return database.setUserPreferences(userId, update); }
function ephemeralError(message) {
  return { embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(`❌ ${message}`)], flags: MessageFlags.Ephemeral };
}

function remainingCooldown(cooldowns, userId, duration, now) {
  const previous = cooldowns.get(userId);
  return previous && now - previous < duration ? Math.ceil((duration - (now - previous)) / 1000) : 0;
}

function recordCooldown(cooldowns, userId, now, duration) {
  cooldowns.set(userId, now);
  if (cooldowns.size > 5_000) {
    for (const [id, timestamp] of cooldowns) {
      if (now - timestamp >= duration) cooldowns.delete(id);
    }
  }
}

async function handleInteraction(client, interaction) {
  const userId = interaction.user?.id;
  if (userId) {
    const now = Date.now();
    const isHealthRefresh = interaction.isButton?.() && interaction.customId?.startsWith(`manage:health-refresh:${userId}`);
    const statusWait = isHealthRefresh
      ? remainingCooldown(healthRefreshCooldowns, userId, HEALTH_REFRESH_COOLDOWN_MS, now)
      : 0;
    const generalWait = remainingCooldown(interactionCooldowns, userId, INTERACTION_COOLDOWN_MS, now);
    const remaining = statusWait || generalWait;
    if (remaining) {
      const language = database.getUser(userId).language;
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(t(language, 'interaction_cooldown_title')).setDescription(`${t(language, 'interaction_cooldown_description')} <t:${Math.ceil((now + remaining * 1000) / 1000)}:R>.`)],
        flags: MessageFlags.Ephemeral
      });
    }
    recordCooldown(interactionCooldowns, userId, now, INTERACTION_COOLDOWN_MS);
    if (isHealthRefresh) recordCooldown(healthRefreshCooldowns, userId, now, HEALTH_REFRESH_COOLDOWN_MS);
  }
  if (interaction.isChatInputCommand()) {
    cancelPendingLanguage(interaction.user.id);
    const command = client.commands.get(interaction.commandName);
    const acknowledged = await acknowledgeCommand(interaction);
    if (command) return command.execute(acknowledged);
    return acknowledged.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_command_unavailable')));
  }
  if (interaction.isModalSubmit()) {
    cancelPendingLanguage(interaction.user.id);
    if (interaction.customId.startsWith('db:reset-modal:')) return handleServerResetModal(interaction);
    if (interaction.customId.startsWith('timestamp:field:')) return timestamp.handleModal(interaction);
    if (interaction.customId === 'timestamp:zone:modal') return timestamp.handleZoneModal(interaction);
    if (interaction.customId.startsWith('convert:field:')) return convert.handleModal(interaction);
    if (interaction.customId.startsWith('convert:zone:modal:')) return convert.handleZoneModal(interaction);
    if (interaction.customId === 'user:timezone:modal') return handleTimezoneModal(interaction);
    return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_expired_form')));
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu?.())
    && !/^user:language-(confirm|cancel):/.test(interaction.customId)) {
    cancelPendingLanguage(interaction.user.id);
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu?.())
    && !/^danger:(confirm|cancel):/.test(interaction.customId)) {
    clearPendingDeletion(deletionKey(interaction));
  }
  const opensModalButton = interaction.isButton() && /^(timestamp:(date|time)|convert:(date|time|source):|db:reset-confirm:)/.test(interaction.customId);
  const opensCustomZoneModal = interaction.isStringSelectMenu()
    && ['timestamp:zone-select:', 'user:timezone-select:', 'convert:zone-select:'].some(prefix => interaction.customId.startsWith(prefix))
    && interaction.values[0] === 'custom';
  const opensModal = opensModalButton || opensCustomZoneModal;
  const isComponentInteraction = interaction.isButton()
    || interaction.isStringSelectMenu()
    || interaction.isUserSelectMenu()
    || interaction.isRoleSelectMenu?.()
    || interaction.isChannelSelectMenu?.();
  if (isComponentInteraction && !opensModal) {
    interaction = await acknowledgeComponent(interaction);
  }
  const isSharedPresenceRefresh = /^presence:refresh:[A-Za-z0-9_-]+$/.test(interaction.customId || '')
    && interaction.guildId === interaction.customId.split(':')[2];
  if (!interaction.customId || owns(interaction.customId, interaction.user.id) || isSharedPresenceRefresh) {
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isRoleSelectMenu?.() || interaction.isChannelSelectMenu?.()) return handleSelect(interaction);
  } else if (interaction.isRepliable()) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_other_owner')));
  if (interaction.isRepliable()) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_unknown_action')));
}

async function previewLanguage(interaction, language) {
  if (!['fr', 'en'].includes(language)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_invalid_language')));
  const previousLanguage = database.getUser(interaction.user.id).language;
  if (language === previousLanguage) {
    return interaction.update(panels.userPayload(interaction, '', 'language-options'));
  }

  const nonce = randomUUID().replace(/-/g, '').slice(0, 16);
  const pending = { nonce, previousLanguage, language, deadline: Date.now() + 10_000, timer: null };
  pendingLanguages.set(interaction.user.id, pending);
  try {
    await interaction.update(panels.languageConfirmationPayload(interaction, language, nonce, pending.deadline));
  } catch (error) {
    pendingLanguages.delete(interaction.user.id);
    throw error;
  }
  pending.timer = setTimeout(() => {
    if (pendingLanguages.get(interaction.user.id) !== pending) return;
    pendingLanguages.delete(interaction.user.id);
    interaction.editReply(panels.userPayload(interaction, t(previousLanguage, 'language_timeout'), 'language-options'))
      .catch(error => logger.warn('Could not restore an unconfirmed language preview', error.stack || error.message));
  }, 10_000);
  pending.timer.unref();
}

function clearPendingDeletion(key) {
  const pending = pendingDeletions.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingDeletions.delete(key);
}

function beginDeletionConfirmation(interaction, type, subjectId = null) {
  const language = database.getUser(interaction.user.id).language;
  const key = deletionKey(interaction);
  clearPendingDeletion(key);
  const nonce = randomUUID().replace(/-/g, '').slice(0, 16);
  const expiresAt = Date.now() + 5_000;
  const pending = { nonce, type, subjectId, guildId: interaction.guildId, language, expiresAt, timer: null };
  pendingDeletions.set(key, pending);
  const confirmationKey = {
    preferences: 'delete_preferences_final',
    permissions: 'delete_permissions_final',
    'managed-user-data': 'delete_user_data_final'
  }[type] || 'delete_second_confirmation';
  const subject = subjectId ? `\n${t(language, 'deletion_subject')}: <@${subjectId}>` : '';
  const payload = {
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'confirm_delete')).setDescription(`${t(language, confirmationKey)}${subject}\n${t(language, 'confirm_before')} <t:${Math.ceil(expiresAt / 1000)}:R>.`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`danger:confirm:${nonce}:${interaction.user.id}`).setLabel(t(language, 'confirm_delete')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`danger:cancel:${nonce}:${interaction.user.id}`).setLabel(t(language, 'cancel')).setStyle(ButtonStyle.Secondary)
    )]
  };
  pending.timer = setTimeout(() => {
    if (pendingDeletions.get(key) !== pending) return;
    pendingDeletions.delete(key);
    interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(`${t(language, 'deletion_expired')} <t:${Math.ceil(Date.now() / 1000)}:R>.`)],
      components: []
    }).catch(error => logger.warn('Could not expire a pending deletion confirmation', error.stack || error.message));
  }, 5_000);
  pending.timer.unref();
  return interaction.update(payload);
}

function openServerResetModal(interaction) {
  const language = database.getUser(interaction.user.id).language;
  const nonce = randomUUID().replace(/-/g, '').slice(0, 16);
  const pending = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    expiresAt: Date.now() + 5 * 60_000,
    timer: null
  };
  pending.timer = setTimeout(() => pendingServerResets.delete(nonce), 5 * 60_000);
  pending.timer.unref();
  pendingServerResets.set(nonce, pending);
  const input = new TextInputBuilder()
    .setCustomId('confirmation')
    .setLabel(t(language, 'server_reset_phrase_label'))
    .setPlaceholder('RESET')
    .setStyle(TextInputStyle.Short)
    .setMinLength(5)
    .setMaxLength(5)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(`db:reset-modal:${nonce}:${interaction.user.id}`)
    .setTitle(t(language, 'server_reset_phrase_title'))
    .addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function handleServerResetModal(interaction) {
  const [, , nonce] = interaction.customId.split(':');
  const pending = pendingServerResets.get(nonce);
  const language = database.getUser(interaction.user.id).language;
  if (!pending || pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId || Date.now() > pending.expiresAt) {
    if (pending) clearTimeout(pending.timer);
    pendingServerResets.delete(nonce);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'server_reset_expired'))], flags: MessageFlags.Ephemeral });
  }
  clearTimeout(pending.timer);
  pendingServerResets.delete(nonce);
  if (!manager(interaction, PERMISSIONS.RESET_DATA)) {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'error_reset_permission'))], flags: MessageFlags.Ephemeral });
  }
  if (interaction.fields.getTextInputValue('confirmation') !== 'RESET') {
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'server_reset_phrase_mismatch'))], flags: MessageFlags.Ephemeral });
  }
  await presenceMonitor.configure(interaction.client, interaction.guildId, {
    channelId: null,
    userIds: [],
    accessMode: 'nobody',
    language
  });
  database.resetGuild(interaction.guildId, interaction.user.id);
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(t(language, 'server_reset_done'))], flags: MessageFlags.Ephemeral });
}

async function finishDeletionConfirmation(interaction, action, nonce) {
  const key = deletionKey(interaction);
  const pending = pendingDeletions.get(key);
  if (!pending || pending.nonce !== nonce) {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(t(database.getUser(interaction.user.id).language, 'deletion_expired'))], components: [] });
  }
  if (Date.now() > pending.expiresAt) {
    clearPendingDeletion(key);
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(t(database.getUser(interaction.user.id).language, 'deletion_expired'))], components: [] });
  }
  if (action === 'cancel') {
    clearPendingDeletion(key);
    if (pending.type === 'preferences') return interaction.update(panels.userPayload(interaction, t(pending.language, 'deletion_cancelled'), 'privacy-delete-preferences'));
    if (pending.type === 'permissions') return interaction.update(panels.userPayload(interaction, t(pending.language, 'deletion_cancelled'), 'privacy-delete-permissions'));
    if (pending.type === 'managed-user-data') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(t(pending.language, 'delete_user_title')).setDescription(`${t(pending.language, 'delete_user_prompt')}\n<@${pending.subjectId}>`)],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`data:delete-confirm:${interaction.user.id}`).setLabel(t(pending.language, 'confirm')).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`db:users:${interaction.user.id}`).setLabel(t(pending.language, 'cancel')).setStyle(ButtonStyle.Secondary)
        )]
      });
    }
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(t(pending.language, 'deletion_cancelled'))], components: [] });
  }
  if (pending.type === 'managed-user-data'
    && (!interaction.guildId || interaction.guildId !== pending.guildId || !manager(interaction, PERMISSIONS.MANAGE_USER_DATA))) {
    clearPendingDeletion(key);
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(pending.language, 'denied'))], components: [] });
  }
  clearPendingDeletion(key);
  if (pending.type === 'preferences') {
    database.deleteUserPreferences(interaction.user.id);
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(t(pending.language, 'preferences_deleted'))], components: [] });
  }
  if (pending.type === 'permissions') {
    if (!interaction.guildId) return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(pending.language, 'no_server_permissions'))], components: [] });
    database.deleteGuildUserPermissions(interaction.guildId, interaction.user.id);
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(t(pending.language, 'server_permissions_deleted'))], components: [] });
  }
  if (pending.type === 'managed-user-data' && pending.subjectId) {
    database.addAudit(pending.guildId, 'user.delete', interaction.user.id, pending.subjectId);
    database.deleteUserData(pending.subjectId);
    selections.delete(selectionKey(interaction));
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0x57f287).setDescription(`${t(pending.language, 'user_data_deleted')} <@${pending.subjectId}>.`)],
      components: []
    });
  }
  return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(pending.language, 'generic_error'))], components: [] });
}

function confirmLanguage(interaction, nonce) {
  const pending = pendingLanguages.get(interaction.user.id);
  if (!pending || pending.nonce !== nonce) {
    return interaction.update(panels.userPayload(interaction, '', 'language-options'));
  }
  cancelPendingLanguage(interaction.user.id);
  database.setUserPreferences(interaction.user.id, { language: pending.language });
  return interaction.update(panels.userPayload(interaction, t(pending.language, 'language_saved'), 'language-options'));
}

function cancelLanguage(interaction, nonce) {
  const pending = pendingLanguages.get(interaction.user.id);
  if (!pending || pending.nonce !== nonce) {
    return interaction.update(panels.userPayload(interaction, '', 'language-options'));
  }
  cancelPendingLanguage(interaction.user.id);
  return interaction.update(panels.userPayload(interaction, '', 'language-options'));
}

async function handleButton(interaction) {
  const [area, action] = interaction.customId.split(':');
  if (area === 'danger' && (action === 'confirm' || action === 'cancel')) {
    return finishDeletionConfirmation(interaction, action, interaction.customId.split(':')[2]);
  }
  if (area === 'dashboard') {
    if (action === 'home') return interaction.update(panels.dashboardPayload(interaction));
    if (action === 'manage') return canOpenServerDashboard(interaction) ? interaction.update(panels.managementPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_no_server_access')));
    if (action === 'user') return interaction.update(panels.userPayload(interaction));
    if (action === 'tools') return interaction.update(panels.toolsPayload(interaction));
  }
  if (area === 'manage') {
    if (action === 'database') return canOpenServerDashboard(interaction) ? interaction.update(panels.databasePayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_no_server_access')));
    if (action === 'stats') return manager(interaction, PERMISSIONS.VIEW_STATS) ? showStats(interaction) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_stats_permission')));
    if (action === 'health') return canOpenServerDashboard(interaction) ? interaction.update(panels.healthPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_no_server_access')));
    if (action === 'health-refresh') return canOpenServerDashboard(interaction) ? interaction.update(panels.healthPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_no_server_access')));
    if (action === 'presence') {
      if (!presenceMonitor.isAvailable()) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'presence_unavailable')));
      if (!hasPermission(interaction, PERMISSIONS.MANAGE_PRESENCE)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'presence_manage_denied')));
      const config = presenceMonitor.getConfiguration(interaction.guildId);
      selections.set(selectionKey(interaction), {
        ...(selections.get(selectionKey(interaction)) || {}),
        presenceMonitor: { channelId: config.channelId, userIds: config.userIds || [], accessMode: config.accessMode || 'owner' }
      });
      return interaction.update(panels.presenceSettingsPayload(interaction, config));
    }
  }
  if (area === 'db') {
    if (action === 'users') return manager(interaction, PERMISSIONS.VIEW_DATA) ? interaction.update(panels.userDataPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_data_permission')));
    if (action === 'permissions') return manager(interaction, PERMISSIONS.MANAGE_PERMISSIONS) ? interaction.update(panels.permissionsPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_admin_permission')));
    if (action === 'export') return manager(interaction, PERMISSIONS.EXPORT_DATA) ? exportGuild(interaction) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_export_permission')));
    if (action === 'reset') return manager(interaction, PERMISSIONS.RESET_DATA) ? confirmReset(interaction) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_reset_permission')));
    if (action === 'journal') return manager(interaction, PERMISSIONS.VIEW_STATS) ? interaction.update(panels.journalPayload(interaction)) : interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_journal_permission')));
  }
  if (area === 'journal') {
    if (action === 'export') {
      if (!manager(interaction, PERMISSIONS.VIEW_STATS)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_journal_permission')));
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.exportAudit(interaction.guildId, getJournalFilters(interaction)), null, 2)), { name: `utils_journal_${interaction.guildId}.json` });
      database.addAudit(interaction.guildId, 'journal.export', interaction.user.id);
      const language = database.getUser(interaction.user.id).language;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(t(language, 'journal_exported')).setDescription(t(language, 'journal_export_description'))], files: [file], flags: MessageFlags.Ephemeral });
    }
    if (action === 'clear') {
      journalFilters.delete(selectionKey(interaction));
      return interaction.update(panels.journalPayload(interaction));
    }
    if (action === 'prev' || action === 'next') {
      if (!manager(interaction, PERMISSIONS.VIEW_STATS)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_journal_permission')));
      const currentPage = Number(interaction.customId.split(':')[2]) || 0;
      const page = action === 'prev' ? currentPage - 1 : currentPage + 1;
      return interaction.update(panels.journalPayload(interaction, page, getJournalFilters(interaction)));
    }
  }
  if (area === 'tool') {
    if (action === 'timestamp') return timestamp.execute(interaction);
    if (action === 'timezone') return convert.execute(interaction);
    if (action === 'back') return interaction.update(panels.toolsPayload(interaction));
  }
  if (area === 'presence') {
    if (action === 'refresh') {
      if (!presenceMonitor.isAvailable()) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'presence_unavailable')));
      if (interaction.customId.split(':')[2] !== interaction.guildId) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'presence_access_denied')));
      return presenceMonitor.refreshInteraction(interaction);
    }
    if (!interaction.guildId || !hasPermission(interaction, PERMISSIONS.MANAGE_PRESENCE)) {
      return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'presence_manage_denied')));
    }
    const key = selectionKey(interaction);
    const state = selections.get(key)?.presenceMonitor || {};
    const language = database.getUser(interaction.user.id).language;
    if (action === 'save') {
      const channel = state.channelId ? await interaction.guild.channels.fetch(state.channelId) : null;
      if (!channel?.isTextBased() || typeof channel.send !== 'function') {
        return interaction.update(panels.presenceSettingsPayload(interaction, { ...presenceMonitor.getConfiguration(interaction.guildId), ...state }, t(language, 'presence_need_channel')));
      }
      if (!state.userIds?.length || state.userIds.length > 5) {
        return interaction.update(panels.presenceSettingsPayload(interaction, { ...presenceMonitor.getConfiguration(interaction.guildId), ...state }, t(language, 'presence_need_members')));
      }
      const configuration = {
        channelId: state.channelId,
        userIds: state.userIds,
        accessMode: state.accessMode || 'owner',
        language
      };
      try {
        await presenceMonitor.configure(interaction.client, interaction.guildId, configuration);
      } catch (error) {
        if (error.code !== 'PRESENCE_CHANNEL_MISSING_PERMISSIONS' && error.code !== 50013) throw error;
        logger.warn(`Could not publish the presence monitor in channel ${state.channelId} of guild ${interaction.guildId}: missing channel permissions.`);
        return interaction.update(panels.presenceSettingsPayload(
          interaction,
          { ...presenceMonitor.getConfiguration(interaction.guildId), ...state },
          t(language, 'presence_channel_permissions')
        ));
      }
      return interaction.update(panels.presenceSettingsPayload(interaction, presenceMonitor.getConfiguration(interaction.guildId), t(language, 'presence_saved')));
    }
    if (action === 'disable') {
      await presenceMonitor.configure(interaction.client, interaction.guildId, { channelId: null, userIds: [], accessMode: state.accessMode || 'owner', language });
      return interaction.update(panels.presenceSettingsPayload(interaction, presenceMonitor.getConfiguration(interaction.guildId), t(language, 'presence_disabled')));
    }
  }
  if (area === 'data') {
    const state = selections.get(selectionKey(interaction));
    if (!state?.memberId) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_select_member')));
    if (action === 'export') {
      if (!manager(interaction, PERMISSIONS.EXPORT_DATA)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_export_permission')));
      const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.getUserData(interaction.guildId, state.memberId), null, 2)), { name: `utils_user_${state.memberId}.json` });
      database.addAudit(interaction.guildId, 'user.export', interaction.user.id, state.memberId);
      const language = database.getUser(interaction.user.id).language;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(t(language, 'user_exported')).setDescription(`${t(language, 'user_export_description')}\n<@${state.memberId}>`)], files: [file], flags: MessageFlags.Ephemeral });
    }
    if (action === 'delete') {
      if (!manager(interaction, PERMISSIONS.MANAGE_USER_DATA)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_user_manage_permission')));
      const language = database.getUser(interaction.user.id).language;
      return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'delete_user_title')).setDescription(`${t(language, 'delete_user_prompt')}\n<@${state.memberId}>`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`data:delete-confirm:${interaction.user.id}`).setLabel(t(language, 'confirm')).setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`db:users:${interaction.user.id}`).setLabel(t(language, 'cancel')).setStyle(ButtonStyle.Secondary))] });
    }
    if (action === 'delete-confirm') {
      if (!manager(interaction, PERMISSIONS.MANAGE_USER_DATA)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_user_manage_permission')));
      return beginDeletionConfirmation(interaction, 'managed-user-data', state.memberId);
    }
  }
  if (area === 'perm') {
    if (!manager(interaction, PERMISSIONS.MANAGE_PERMISSIONS)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_admin_permission')));
    if (action === 'enable' || action === 'disable') {
      const selection = selections.get(selectionKey(interaction));
      if ((!selection?.memberId && !selection?.roleId) || !selection.permission) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_permission_selection')));
      if (!Object.hasOwn(PERMISSION_LABELS, selection.permission) || !canManagePermission(interaction, selection.permission)) {
        return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_permission_delegation')));
      }
      if (selection.roleId) {
        if (action === 'enable') grantRolePermission(interaction.guildId, selection.roleId, selection.permission, interaction.user.id);
        else revokeRolePermission(interaction.guildId, selection.roleId, selection.permission, interaction.user.id);
      } else if (action === 'enable') grantPermission(interaction.guildId, selection.memberId, selection.permission, interaction.user.id);
      else revokePermission(interaction.guildId, selection.memberId, selection.permission, interaction.user.id);
      return interaction.update(panels.permissionsPayload(interaction, selection.memberId, selection.permission, selection.roleId));
    }
  }
  if (area === 'db' && action === 'reset-confirm') {
    if (!manager(interaction, PERMISSIONS.RESET_DATA)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_reset_permission')));
    return openServerResetModal(interaction);
  }
  if (area === 'user') {
    if (action === 'category') return interaction.update(panels.userPayload(interaction, '', interaction.customId.split(':')[2]));
    if (action === 'submenu') {
      const section = interaction.customId.split(':')[2];
      if (!['language', 'privacy'].includes(section)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_submenu_unavailable')));
      return interaction.update(panels.userPayload(interaction, '', section));
    }
    if (action === 'settings') {
      const section = interaction.customId.split(':')[2];
      if (!['language', 'privacy'].includes(section)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_submenu_unavailable')));
      return interaction.update(panels.userPayload(interaction, '', section === 'language' ? 'language-options' : 'privacy'));
    }
    if (action === 'language-preview') return previewLanguage(interaction, interaction.customId.split(':')[2]);
    if (action === 'language-confirm') return confirmLanguage(interaction, interaction.customId.split(':')[2]);
    if (action === 'language-cancel') return cancelLanguage(interaction, interaction.customId.split(':')[2]);
    if (action === 'privacy') {
      const destination = interaction.customId.split(':')[2];
      if (destination === 'view') return interaction.update(panels.userPayload(interaction, '', 'privacy-data'));
      if (destination === 'delete-preferences') return interaction.update(panels.userPayload(interaction, '', 'privacy-delete-preferences'));
      if (destination === 'delete-permissions') {
        if (!interaction.guildId) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'no_server_permissions')));
        return interaction.update(panels.userPayload(interaction, '', 'privacy-delete-permissions'));
      }
    }
    if (action === 'delete-preferences-confirm') {
      return beginDeletionConfirmation(interaction, 'preferences');
    }
    if (action === 'delete-permissions-confirm') {
      if (!interaction.guildId) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'no_server_permissions')));
      return beginDeletionConfirmation(interaction, 'permissions');
    }
  }
  if (area === 'timestamp') {
    if (action === 'zone') return interaction.update(panels.timestampZonePayload(interaction, timestamp.getDraft(interaction.user.id).zone));
    if (action === 'date' || action === 'time') return timestamp.openField(interaction, action);
    if (action === 'confirm') return timestamp.confirm(interaction);
    if (action === 'disambiguation') return timestamp.handleDisambiguation(interaction, Number(interaction.customId.split(':')[2]));
    if (action === 'back') return interaction.update(panels.timestampPayload(interaction, timestamp.getDraft(interaction.user.id)));
    if (action === 'again') return timestamp.again(interaction);
  }
  if (area === 'convert') {
    if (action === 'zone-back') return interaction.update(panels.convertPayload(interaction, convert.getDraft(interaction.user.id)));
    if (action === 'zone') return interaction.update(panels.convertZonePayload(interaction, interaction.customId.split(':')[2], convert.getDraft(interaction.user.id)));
    if (action === 'date' || action === 'time') return convert.openField(interaction, action);
    if (action === 'confirm') return convert.confirm(interaction);
    if (action === 'back') return interaction.update(panels.convertPayload(interaction, convert.getDraft(interaction.user.id)));
    if (action === 'again') return convert.again(interaction);
    if (action === 'disambiguation') return convert.handleDisambiguation(interaction, Number(interaction.customId.split(':')[2]));
  }
}

async function handleSelect(interaction) {
  const [area, action] = interaction.customId.split(':');
  if (area === 'journal' && (action === 'users' || action === 'actions')) {
    if (!manager(interaction, PERMISSIONS.VIEW_STATS)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_journal_permission')));
    const key = selectionKey(interaction);
    const filters = getJournalFilters(interaction);
    const selectedValues = [...new Set(interaction.values)].slice(0, 25);
    if (action === 'users') {
      filters.users = selectedValues;
    } else {
      const validActions = new Set(database.getAuditActions(interaction.guildId));
      filters.actions = selectedValues.filter(value => validActions.has(value));
    }
    journalFilters.set(key, filters);
    return interaction.update(panels.journalPayload(interaction, 0, filters));
  }
  if (area === 'convert' && action === 'zone-select') {
    const role = interaction.customId.split(':')[2];
    const value = interaction.values[0];
    if (value === 'custom') return convert.openZoneField(interaction, role);
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'invalid_zone')));
    const draft = convert.getDraft(interaction.user.id);
    draft[role] = value;
    convert.drafts.set(interaction.user.id, draft);
    return interaction.update(panels.convertPayload(interaction, draft));
  }
  if (area === 'presence') {
    const key = selectionKey(interaction);
    const selection = selections.get(key) || {};
    const state = selection.presenceMonitor || { ...presenceMonitor.getConfiguration(interaction.guildId) };
    if (action === 'channel') state.channelId = interaction.values[0] || null;
    else if (action === 'members') state.userIds = [...new Set(interaction.values)].slice(0, 5);
    else if (action === 'access' && presenceMonitor.VALID_ACCESS_MODES.has(interaction.values[0])) state.accessMode = interaction.values[0];
    else return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_invalid_preference')));
    selection.presenceMonitor = state;
    selections.set(key, selection);
    return interaction.update(panels.presenceSettingsPayload(interaction, { ...presenceMonitor.getConfiguration(interaction.guildId), ...state }));
  }
  if (area === 'timestamp' && action === 'zone-select') {
    const value = interaction.values[0];
    if (value === 'custom') return timestamp.openZoneField(interaction);
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'invalid_zone')));
    const draft = timestamp.getDraft(interaction.user.id);
    draft.zone = value;
    timestamp.drafts.set(interaction.user.id, draft);
    return interaction.update(panels.timestampPayload(interaction, draft));
  }
  if (area === 'user' && action === 'timezone-select') {
    const value = interaction.values[0];
    if (value === 'custom') {
      const previous = timezoneOrigins.get(interaction.user.id);
      if (previous) clearTimeout(previous.timer);
      const timer = setTimeout(() => timezoneOrigins.delete(interaction.user.id), 15 * 60_000);
      timer.unref();
      timezoneOrigins.set(interaction.user.id, { interaction, timer });
      const settings = database.getUser(interaction.user.id);
      return interaction.showModal(require('./modals').timezone(settings.timezone, settings.language));
    }
    if (!isSelectableZone(value)) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'invalid_zone')));
    updateSettings(interaction.user.id, { timezone: value });
    return interaction.update(panels.userPayload(interaction, `${t(database.getUser(interaction.user.id).language, 'timezone_updated')} **${value}**.`, 'region'));
  }
  if (area === 'user') {
    const preferences = {
      'date-mode': { key: 'dateFormats', values: ['DMY', 'MDY', 'YMD'], array: true },
      'time-mode': { key: 'timeFormats', values: ['HMS', 'HM', 'TEXT'], array: true },
      'date-sep': { key: 'dateSeparator', values: ['/', '.', '-', ','] },
      'time-sep': { key: 'timeSeparator', values: [':', '.', '-', ',', 'h'] },
      seconds: { key: 'showSeconds', values: ['true', 'false'], parse: value => value === 'true' },
      iso: { key: 'isoDates', values: ['true', 'false'], parse: value => value === 'true' },
      language: { key: 'language', values: ['fr', 'en'] }
    };
    const preference = Object.hasOwn(preferences, action) ? preferences[action] : null;
    if (!preference || !preference.values.includes(interaction.values[0])) return interaction.reply(ephemeralError(t(database.getUser(interaction.user.id).language, 'error_invalid_preference')));
    const value = preference.parse ? preference.parse(interaction.values[0]) : interaction.values[0];
    updateSettings(interaction.user.id, { [preference.key]: preference.array ? [value] : value });
    const category = { 'date-mode': 'dates', 'date-sep': 'dates', iso: 'dates', 'time-mode': 'times', 'time-sep': 'times', seconds: 'times' }[action] || 'language';
    return interaction.update(panels.userPayload(interaction, t(database.getUser(interaction.user.id).language, 'updated'), category));
  }
  if (area === 'perm' && action === 'user') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.memberId = interaction.values[0]; state.roleId = null; selections.set(key, state); return interaction.update(panels.permissionsPayload(interaction, state.memberId, state.permission)); }
  if (area === 'perm' && action === 'role') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.roleId = interaction.values[0]; state.memberId = null; selections.set(key, state); return interaction.update(panels.permissionsPayload(interaction, null, state.permission, state.roleId)); }
  if (area === 'perm' && action === 'type') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.permission = interaction.values[0]; selections.set(key, state); return interaction.update(panels.permissionsPayload(interaction, state.memberId, state.permission, state.roleId)); }
  if (area === 'data' && action === 'user') { const key = selectionKey(interaction); const state = selections.get(key) || {}; state.memberId = interaction.values[0]; selections.set(key, state); return showUserData(interaction, state.memberId); }
}

async function handleTimezoneModal(interaction) {
  const value = interaction.fields.getTextInputValue('timezone').trim();
  const language = database.getUser(interaction.user.id).language;
  if (!isSelectableZone(value)) return interaction.reply(ephemeralError(t(language, 'invalid_zone')));
  updateSettings(interaction.user.id, { timezone: value });
  const pendingOrigin = timezoneOrigins.get(interaction.user.id);
  const origin = pendingOrigin?.interaction;
  if (pendingOrigin) clearTimeout(pendingOrigin.timer);
  timezoneOrigins.delete(interaction.user.id);
  if (origin) await origin.editReply(panels.userPayload(interaction, `${t(language, 'timezone_updated')} **${value}**.`, 'region'));
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(t(language, 'timezone_saved_title')).setDescription(`${t(language, 'timezone_saved')} **${value}**.`)], flags: MessageFlags.Ephemeral });
}

function userSelect(customId, placeholder) { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)); }
function showStats(interaction) {
  const stats = database.getStats(interaction.guildId);
  const language = database.getUser(interaction.user.id).language;
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(t(language, 'server_stats_title')).addFields({ name: t(language, 'server_audit_label'), value: String(stats.audit), inline: true })],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`manage:database:${interaction.user.id}`).setLabel(t(language, 'database_back')).setStyle(ButtonStyle.Secondary))]
  });
}

function exportGuild(interaction) {
  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(database.exportGuild(interaction.guildId), null, 2)), { name: `utils_${interaction.guildId}.json` });
  database.addAudit(interaction.guildId, 'guild.export', interaction.user.id);
  const language = database.getUser(interaction.user.id).language;
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(t(language, 'server_exported')).setDescription(t(language, 'server_export_description'))], files: [file], flags: MessageFlags.Ephemeral });
}

function confirmReset(interaction) {
  const language = database.getUser(interaction.user.id).language;
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'server_reset_confirm_title')).setDescription(t(language, 'server_reset_confirm_description'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`db:reset-confirm:${interaction.user.id}`).setLabel(t(language, 'confirm')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`manage:database:${interaction.user.id}`).setLabel(t(language, 'cancel')).setStyle(ButtonStyle.Secondary)
    )]
  });
}

function showUserData(interaction, userId) {
  const language = database.getUser(interaction.user.id).language;
  if (!manager(interaction, PERMISSIONS.VIEW_DATA)) return interaction.reply(ephemeralError(t(language, 'error_data_permission')));
  const data = database.getUserData(interaction.guildId, userId);
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${t(language, 'user_data_title')} • ${userId}`).addFields(
      { name: t(language, 'timezone'), value: data.preferences.timezone, inline: true },
      { name: t(language, 'language'), value: data.preferences.language.toUpperCase(), inline: true },
      { name: t(language, 'health_audit'), value: String(data.audit.length), inline: true }
    )],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`data:export:${interaction.user.id}`).setLabel(t(language, 'database_export')).setStyle(ButtonStyle.Secondary).setDisabled(!manager(interaction, PERMISSIONS.EXPORT_DATA)),
        new ButtonBuilder().setCustomId(`data:delete:${interaction.user.id}`).setLabel(t(language, 'delete_data')).setStyle(ButtonStyle.Danger).setDisabled(!manager(interaction, PERMISSIONS.MANAGE_USER_DATA))
      ),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`db:users:${interaction.user.id}`).setLabel(t(language, 'back')).setStyle(ButtonStyle.Secondary))
    ]
  });
}

module.exports = { beginDeletionConfirmation, cancelLanguage, cancelPendingLanguage, confirmLanguage, finishDeletionConfirmation, handleInteraction, healthRefreshCooldowns, interactionCooldowns, journalFilters, pendingDeletions, pendingLanguages, pendingServerResets, previewLanguage, timezoneOrigins };
