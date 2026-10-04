const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, MessageFlags, RoleSelectMenuBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const database = require('./database');
const { zoneOptions } = require('./components');
const { PERMISSIONS, PERMISSION_LABELS, canOpenServerDashboard, hasPermission } = require('./permissions');
const { t } = require('./i18n');
const presenceMonitor = require('./presence-monitor');

const COLORS = { main: 0x5865f2, success: 0x57f287, warning: 0xfee75c, danger: 0xed4245 };

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function owner(interaction) { return interaction.user.id; }
function row(...buttons) { return new ActionRowBuilder().addComponents(buttons); }
function back(id, language = 'fr') { return row(button(id, t(language, 'back'))); }
function embed(title, description, color = COLORS.main) { return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description); }
function userSelect(customId, placeholder) { return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)); }
function auditUserSelect(customId, placeholder, selectedUsers) {
  const menu = new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(25);
  if (selectedUsers.length) menu.setDefaultUsers(...selectedUsers);
  return new ActionRowBuilder().addComponents(menu);
}
function roleSelect(customId, placeholder) {
  return new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1));
}
function permissionSelect(customId, selected, language, canAssignPermissionManager) {
  const assignable = Object.entries(PERMISSION_LABELS).filter(([value]) => canAssignPermissionManager || value !== PERMISSIONS.MANAGE_PERMISSIONS);
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(t(language, 'choose_permission')).addOptions(assignable.map(([value, key]) => ({ label: t(language, key), value, description: value, default: value === selected }))));
}
function preferenceSelect(customId, placeholder, values, selected, labels = {}) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(values.map(value => ({
    label: labels[value] || value,
    value,
    default: value === selected
  }))));
}

function dashboardPayload(interaction) {
  const canManage = canOpenServerDashboard(interaction);
  const language = database.getUser(owner(interaction)).language;
  const title = interaction.guild?.name || t(language, 'direct_messages');
  const description = canManage
    ? t(language, 'dashboard_manager_welcome')
    : t(language, 'dashboard_personal_welcome');
  const buttons = [button(`dashboard:user:${owner(interaction)}`, t(language, 'dashboard_preferences'), ButtonStyle.Primary), button(`dashboard:tools:${owner(interaction)}`, t(language, 'dashboard_time_tools'))];
  if (canManage) buttons.unshift(button(`dashboard:manage:${owner(interaction)}`, t(language, 'dashboard_manage'), ButtonStyle.Secondary));
  return { embeds: [embed(`${t(language, 'dashboard_title')} • ${title}`, description).addFields({ name: t(language, 'dashboard_profile'), value: t(language, 'dashboard_profile_description'), inline: true }, { name: t(language, 'dashboard_tools'), value: t(language, 'dashboard_tools_description'), inline: true })], components: [row(...buttons)], flags: MessageFlags.Ephemeral };
}

function toolsPayload(interaction) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  return { embeds: [embed(t(language, 'tools_title'), t(language, 'tools_intro'), COLORS.main).addFields({ name: t(language, 'timestamp_title'), value: t(language, 'timestamp_intro'), inline: true }, { name: t(language, 'conversion_title'), value: t(language, 'conversion_intro'), inline: true })], components: [row(button(`tool:timestamp:${id}`, t(language, 'timestamp_title'), ButtonStyle.Primary), button(`tool:timezone:${id}`, t(language, 'conversion_title'), ButtonStyle.Primary)), row(button(`dashboard:home:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function managementPayload(interaction) {
  const language = database.getUser(owner(interaction)).language;
  const canStats = hasPermission(interaction, PERMISSIONS.VIEW_STATS);
  const canManagePresence = hasPermission(interaction, PERMISSIONS.MANAGE_PRESENCE) && presenceMonitor.isAvailable();
  const stats = canStats ? database.getStats(interaction.guildId) : null;
  return { embeds: [embed(t(language, 'management_title'), t(language, 'management_description')).addFields({ name: t(language, 'management_audit'), value: canStats ? String(stats.audit) : t(language, 'access_required'), inline: true }, { name: t(language, 'management_permissions'), value: t(language, 'management_permission_note'), inline: true })], components: [row(button(`manage:database:${owner(interaction)}`, t(language, 'database_title'), ButtonStyle.Primary), button(`manage:stats:${owner(interaction)}`, t(language, 'server_stats_title')).setDisabled(!canStats)), row(button(`manage:health:${owner(interaction)}`, t(language, 'health_title')), button(`manage:presence:${owner(interaction)}`, t(language, 'presence_config_title')).setDisabled(!canManagePresence), button(`dashboard:home:${owner(interaction)}`, t(language, 'back')))], flags: MessageFlags.Ephemeral };
}

function presenceSettingsPayload(interaction, configuration, notice = '') {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  if (configuration.publishPaused && !notice) notice = t(language, 'presence_monitor_paused');
  const accessOptions = ['permission', 'owner', 'nobody', 'everyone'].map(mode => ({
    label: t(language, `presence_access_${mode}`),
    value: mode,
    default: configuration.accessMode === mode
  }));
  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`presence:channel:${id}`)
    .setPlaceholder(t(language, 'presence_channel_select'))
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);
  if (configuration.channelId) channelMenu.setDefaultChannels(configuration.channelId);
  const memberMenu = new UserSelectMenuBuilder()
    .setCustomId(`presence:members:${id}`)
    .setPlaceholder(t(language, 'presence_members_select'))
    .setMinValues(0)
    .setMaxValues(5);
  if (configuration.userIds?.length) memberMenu.setDefaultUsers(...configuration.userIds);
  const monitored = configuration.userIds?.length
    ? configuration.userIds.map(userId => `<@${userId}>`).join(', ')
    : t(language, 'presence_no_members');
  return {
    embeds: [embed(t(language, 'presence_config_title'), `${notice ? `${notice}\n\n` : ''}${t(language, 'presence_config_description')}`).addFields(
      { name: t(language, 'presence_channel_select'), value: configuration.channelId ? `<#${configuration.channelId}>` : t(language, 'health_unavailable'), inline: true },
      { name: t(language, 'presence_members_select'), value: monitored, inline: false },
      { name: t(language, 'presence_access_select'), value: t(language, `presence_access_${configuration.accessMode || 'owner'}`), inline: true }
    )],
    components: [
      new ActionRowBuilder().addComponents(channelMenu),
      new ActionRowBuilder().addComponents(memberMenu),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`presence:access:${id}`)
        .setPlaceholder(t(language, 'presence_access_select'))
        .addOptions(accessOptions)),
      row(button(`presence:save:${id}`, t(language, 'presence_save'), ButtonStyle.Success), button(`presence:disable:${id}`, t(language, 'presence_disable'), ButtonStyle.Danger), button(`dashboard:manage:${id}`, t(language, 'back')))
    ],
    flags: MessageFlags.Ephemeral
  };
}

function healthPayload(interaction) {
  const uptime = Math.floor(process.uptime());
  const language = database.getUser(owner(interaction)).language;
  const startedAt = Math.floor(Date.now() / 1000) - uptime;
  const ping = Number.isFinite(interaction.client.ws.ping) ? `${Math.round(interaction.client.ws.ping)} ms` : t(language, 'health_unavailable');
  const memory = process.memoryUsage();
  const megabytes = value => `${(value / 1024 / 1024).toFixed(1)} MB`;
  const guilds = interaction.client.guilds.cache.size;
  const members = [...interaction.client.guilds.cache.values()].reduce((total, guild) => total + (guild.memberCount || 0), 0);
  const shards = interaction.client.ws.shards?.size || interaction.client.ws.shards?.length || 0;
  const readyAt = interaction.client.readyAt ? Math.floor(interaction.client.readyAt.getTime() / 1000) : null;
  const statusEmoji = interaction.client.isReady() ? '🟢' : '🟡';
  const fields = [
    { name: `📡 ${t(language, 'health_status')}`, value: `${statusEmoji} ${t(language, interaction.client.isReady() ? 'health_ready' : 'health_connecting')}`, inline: true },
    { name: `⏱️ ${t(language, 'health_uptime')}`, value: `<t:${startedAt}:R>`, inline: true },
    { name: `🌐 ${t(language, 'health_gateway')}`, value: `📶 ${ping}`, inline: true },
    { name: `🏠 ${t(language, 'health_guilds')}`, value: `\`${guilds.toLocaleString()}\``, inline: true },
    { name: `👥 ${t(language, 'health_members')}`, value: `\`${members.toLocaleString()}\``, inline: true },
    { name: `🔀 ${t(language, 'health_shards')}`, value: `\`${shards}\``, inline: true },
    { name: `⌨️ ${t(language, 'health_commands')}`, value: `\`${interaction.client.commands?.size || 0}\``, inline: true },
    { name: `🟩 ${t(language, 'health_runtime')}`, value: `\`${process.version}\``, inline: true },
    { name: `🧠 ${t(language, 'health_memory')}`, value: `💾 ${t(language, 'health_rss')}: ${megabytes(memory.rss)}\n📊 ${t(language, 'health_heap')}: ${megabytes(memory.heapUsed)} / ${megabytes(memory.heapTotal)}`, inline: true },
    { name: `🧾 ${t(language, 'health_audit')}`, value: `\`${database.getStats(interaction.guildId).audit.toLocaleString()}\``, inline: true },
    { name: `🕒 ${t(language, 'health_connected_since')}`, value: readyAt ? `<t:${readyAt}:R>` : t(language, 'health_unavailable'), inline: true }
  ];
  return { embeds: [embed(t(language, 'health_title'), t(language, 'health_description')).addFields(...fields)], components: [row(button(`manage:health-refresh:${owner(interaction)}`, t(language, 'health_refresh'), ButtonStyle.Primary), button(`dashboard:manage:${owner(interaction)}`, t(language, 'back')))], flags: MessageFlags.Ephemeral };
}

function databasePayload(interaction) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  const canData = hasPermission(interaction, PERMISSIONS.VIEW_DATA);
  const canExport = hasPermission(interaction, PERMISSIONS.EXPORT_DATA);
  const canReset = hasPermission(interaction, PERMISSIONS.RESET_DATA);
  const canStats = hasPermission(interaction, PERMISSIONS.VIEW_STATS);
  return { embeds: [embed(t(language, 'database_title'), t(language, 'database_intro')).addFields({ name: t(language, 'database_permissions'), value: t(language, 'database_permissions_description'), inline: true }, { name: t(language, 'database_users'), value: t(language, 'database_users_description'), inline: true }, { name: t(language, 'database_journal'), value: t(language, 'database_journal_description'), inline: true })], components: [row(button(`db:permissions:${id}`, t(language, 'database_permissions'), ButtonStyle.Primary).setDisabled(!hasPermission(interaction, PERMISSIONS.MANAGE_PERMISSIONS)), button(`db:users:${id}`, t(language, 'database_users')).setDisabled(!canData), button(`db:journal:${id}`, t(language, 'database_journal')).setDisabled(!canStats)), row(button(`db:export:${id}`, t(language, 'database_export')).setDisabled(!canExport), button(`db:reset:${id}`, t(language, 'database_reset'), ButtonStyle.Danger).setDisabled(!canReset), button(`dashboard:manage:${id}`, t(language, 'back')))], flags: MessageFlags.Ephemeral };
}

function journalPayload(interaction, page = 0, filters = { users: [], actions: [] }) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  const journal = database.getAuditPage(interaction.guildId, page, 8, filters);
  const availableActions = database.getAuditActions(interaction.guildId);
  const actionOptions = availableActions.map(action => ({
    label: action,
    value: action,
    default: journal.filters.actions.includes(action)
  }));
  const actionSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`journal:actions:${id}`)
      .setPlaceholder(`${t(language, 'journal_filter_actions')}${journal.filters.actions.length ? ` (${journal.filters.actions.length})` : ''}`)
      .setMinValues(0)
      .setMaxValues(actionOptions.length)
      .addOptions(actionOptions)
  );
  const selectedFilters = [
    journal.filters.users.length ? `${t(language, 'journal_filter_users')}: ${journal.filters.users.map(userId => `<@${userId}>`).join(', ')}` : '',
    journal.filters.actions.length ? `${t(language, 'journal_filter_actions')}: ${journal.filters.actions.join(', ')}` : ''
  ].filter(Boolean);
  const description = journal.entries.length ? journal.entries.map(entry => `**${entry.action}** • <@${entry.actorId}> • <t:${Math.floor(entry.timestamp / 1000)}:R>${entry.details ? `\n> ${entry.details}` : ''}`).join('\n\n') : t(language, 'journal_empty');
  const navigation = [
    button(`journal:prev:${journal.page}:${id}`, t(language, 'journal_previous')).setDisabled(journal.page <= 0),
    button(`journal:next:${journal.page}:${id}`, t(language, 'journal_next')).setDisabled(journal.page >= journal.totalPages - 1),
    button(`journal:export:${id}`, t(language, 'journal_export'))
  ];
  return {
    embeds: [embed(t(language, 'journal_title'), `${t(language, 'page')} **${journal.page + 1}/${journal.totalPages}** • ${journal.total} ${t(language, 'actions')}${selectedFilters.length ? `\n${selectedFilters.join('\n')}` : ''}\n\n${description}`)],
    components: [
      auditUserSelect(`journal:users:${id}`, `${t(language, 'journal_filter_users')}${journal.filters.users.length ? ` (${journal.filters.users.length})` : ''}`, journal.filters.users),
      actionSelect,
      row(...navigation),
      row(button(`journal:clear:${id}`, t(language, 'journal_clear_filters')).setDisabled(!journal.filters.users.length && !journal.filters.actions.length), button(`manage:database:${id}`, t(language, 'back'), ButtonStyle.Secondary))
    ],
    flags: MessageFlags.Ephemeral
  };
}

function permissionsPayload(interaction, selectedUser, selectedPermission, selectedRole = null) {
  const id = owner(interaction);
  const entries = database.getPermissions(interaction.guildId).filter(entry => (
    (!selectedUser && !selectedRole)
    || (selectedUser && entry.subjectType === 'user' && entry.subjectId === selectedUser)
    || (selectedRole && entry.subjectType === 'role' && entry.subjectId === selectedRole)
  ));
  const language = database.getUser(id).language;
  const labels = new Map(Object.entries(PERMISSION_LABELS).map(([permission, key]) => [permission, t(language, key)]));
  const summary = entries.length ? entries.map(entry => `${entry.subjectType === 'role' ? `<@&${entry.subjectId}>` : `<@${entry.subjectId}>`} • **${labels.get(entry.permission) || entry.permission}**`).join('\n').slice(0, 1024) : t(language, 'no_permissions_selected');
  const hasTarget = Boolean(selectedUser || selectedRole);
  return {
    embeds: [embed(t(language, 'permissions_title'), t(language, 'permissions_intro')).addFields({ name: t(language, 'current_permissions'), value: summary, inline: false })],
    components: [
      userSelect(`perm:user:${id}`, t(language, 'select_member')),
      roleSelect(`perm:role:${id}`, t(language, 'select_role')),
      permissionSelect(`perm:type:${id}`, selectedPermission, language, interaction.guild?.ownerId === id),
      row(button(`perm:enable:${id}`, t(language, 'grant_permission'), ButtonStyle.Success).setDisabled(!hasTarget || !selectedPermission), button(`perm:disable:${id}`, t(language, 'revoke_permission'), ButtonStyle.Danger).setDisabled(!hasTarget || !selectedPermission)),
      back(`manage:database:${id}`, language)
    ],
    flags: MessageFlags.Ephemeral
  };
}

function userDataPayload(interaction) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  return {
    embeds: [embed(t(language, 'user_data_title'), t(language, 'user_data_intro'))],
    components: [userSelect(`data:user:${id}`, t(language, 'select_member')), back(`manage:database:${id}`, language)],
    flags: MessageFlags.Ephemeral
  };
}

function userPayload(interaction, notice = '', category = 'home') {
  const settings = database.getUser(interaction.user.id);
  const id = owner(interaction);
  const categories = ['region', 'dates', 'times', 'language'];
  const categoryButtons = row(
    ...categories.map(value => button(`user:category:${value}:${id}`, t(settings.language, `category_${value === 'region' ? 'region' : value === 'dates' ? 'date' : value === 'times' ? 'time' : 'language'}`), value === category ? ButtonStyle.Primary : ButtonStyle.Secondary))
  );
  const categoryTitle = {
    home: t(settings.language, 'bot_description'),
    region: t(settings.language, 'region_help'),
    dates: t(settings.language, 'date_help'),
    times: t(settings.language, 'time_help'),
    language: t(settings.language, 'language_help'),
    'language-options': t(settings.language, 'language_options_intro'),
    privacy: t(settings.language, 'privacy_intro'),
    'privacy-data': t(settings.language, 'privacy_data_intro'),
    'privacy-delete-preferences': t(settings.language, 'privacy_delete_preferences_confirm'),
    'privacy-delete-permissions': t(settings.language, 'privacy_delete_permissions_confirm')
  }[category] || t(settings.language, 'choose_category');
  const categoryName = {
    home: 'bot_description_title',
    region: 'category_region',
    dates: 'category_date',
    times: 'category_time',
    language: 'category_language'
  }[category] || 'category_language';
  let preferenceRows = [];

  if (category === 'region') {
    preferenceRows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`user:timezone-select:${id}`)
      .setPlaceholder(t(settings.language, 'timezone'))
      .addOptions(zoneOptions(settings.timezone, settings.language)))];
  } else if (category === 'dates') {
    preferenceRows = [
      preferenceSelect(`user:date-mode:${id}`, t(settings.language, 'date_format'), ['DMY', 'MDY', 'YMD'], settings.dateFormats[0], { DMY: t(settings.language, 'date_format_desc'), MDY: t(settings.language, 'date_format_us'), YMD: t(settings.language, 'date_format_iso') }),
      preferenceSelect(`user:date-sep:${id}`, t(settings.language, 'date_separator'), ['/', '.', '-', ','], settings.dateSeparator),
      preferenceSelect(`user:iso:${id}`, t(settings.language, 'iso'), ['true', 'false'], String(settings.isoDates), { true: t(settings.language, 'iso_on'), false: t(settings.language, 'iso_off') })
    ];
  } else if (category === 'times') {
    preferenceRows = [
      preferenceSelect(`user:time-mode:${id}`, t(settings.language, 'time_format'), ['HMS', 'HM', 'TEXT'], settings.timeFormats[0], { HMS: t(settings.language, 'time_hms'), HM: t(settings.language, 'time_hm'), TEXT: t(settings.language, 'time_text') }),
      preferenceSelect(`user:time-sep:${id}`, t(settings.language, 'time_separator'), [':', '.', '-', ',', 'h'], settings.timeSeparator),
      preferenceSelect(`user:seconds:${id}`, t(settings.language, 'seconds'), ['true', 'false'], String(settings.showSeconds), { true: t(settings.language, 'yes_seconds'), false: t(settings.language, 'no_seconds') })
    ];
  } else if (category === 'language') {
    preferenceRows = [row(
      button(`user:settings:language:${id}`, t(settings.language, 'language_menu'), ButtonStyle.Primary),
      button(`user:settings:privacy:${id}`, t(settings.language, 'privacy_menu'))
    )];
  } else if (category === 'language-options') {
    preferenceRows = [
      row(button(`user:language-preview:fr:${id}`, t(settings.language, 'french'), settings.language === 'fr' ? ButtonStyle.Success : ButtonStyle.Primary), button(`user:language-preview:en:${id}`, t(settings.language, 'english'), settings.language === 'en' ? ButtonStyle.Success : ButtonStyle.Primary)),
      back(`user:submenu:language:${id}`, settings.language)
    ];
  } else if (category === 'privacy') {
    preferenceRows = [
      row(button(`user:privacy:view:${id}`, t(settings.language, 'privacy_view'), ButtonStyle.Primary)),
      row(button(`user:privacy:delete-preferences:${id}`, t(settings.language, 'privacy_delete_preferences'), ButtonStyle.Danger), button(`user:privacy:delete-permissions:${id}`, t(settings.language, 'privacy_delete_permissions'), ButtonStyle.Danger).setDisabled(!interaction.guildId)),
      back(`user:submenu:privacy:${id}`, settings.language)
    ];
  } else if (category === 'privacy-data') {
    preferenceRows = [back(`user:settings:privacy:${id}`, settings.language)];
  } else if (category === 'privacy-delete-preferences' || category === 'privacy-delete-permissions') {
    const deletePreferences = category === 'privacy-delete-preferences';
    preferenceRows = [row(
      button(`user:${deletePreferences ? 'delete-preferences-confirm' : 'delete-permissions-confirm'}:${id}`, t(settings.language, 'confirm_delete'), ButtonStyle.Danger),
      button(`user:settings:privacy:${id}`, t(settings.language, 'cancel'))
    )];
  }

  const footer = row(button(`dashboard:home:${id}`, t(settings.language, 'back_dashboard')));
  const titleKey = category === 'language-options' || category === 'privacy' || category.startsWith('privacy-')
    ? category === 'language-options' ? 'language_menu' : 'privacy_menu'
    : categoryName;
  const details = category === 'region'
    ? [
      { name: t(settings.language, 'timezone'), value: `**${settings.timezone}**\n${t(settings.language, 'select_timezone_from_menu')}`, inline: true },
      ...(settings.automaticUtcGmt ? [{ name: 'UTC / GMT', value: t(settings.language, 'region_auto_utc_gmt'), inline: false }] : [])
    ]
    : category === 'dates'
      ? [{ name: t(settings.language, 'date_format'), value: settings.dateFormats[0], inline: true }, { name: t(settings.language, 'date_separator'), value: settings.dateSeparator, inline: true }, { name: t(settings.language, 'iso'), value: settings.isoDates ? t(settings.language, 'yes') : t(settings.language, 'no'), inline: true }]
      : category === 'times'
        ? [{ name: t(settings.language, 'time_format'), value: settings.timeFormats[0], inline: true }, { name: t(settings.language, 'time_separator'), value: settings.timeSeparator, inline: true }, { name: t(settings.language, 'seconds'), value: settings.showSeconds ? t(settings.language, 'yes_seconds') : t(settings.language, 'no_seconds'), inline: true }]
        : category === 'language' || category === 'language-options'
          ? [{ name: t(settings.language, 'language'), value: settings.language.toUpperCase(), inline: true }]
          : [];
  if (category === 'privacy-data') {
    const ownData = database.getOwnData(id, interaction.guildId);
    details.push(
      { name: t(settings.language, 'timezone'), value: ownData.preferences.timezone, inline: true },
      { name: t(settings.language, 'language'), value: ownData.preferences.language.toUpperCase(), inline: true },
      { name: t(settings.language, 'date_format'), value: `${ownData.preferences.dateFormats[0]} • ${ownData.preferences.dateSeparator}`, inline: true },
      { name: t(settings.language, 'time_format'), value: `${ownData.preferences.timeFormats[0]} • ${ownData.preferences.timeSeparator} • ${ownData.preferences.showSeconds ? t(settings.language, 'yes_seconds') : t(settings.language, 'no_seconds')}`, inline: true },
      { name: t(settings.language, 'iso'), value: ownData.preferences.isoDates ? t(settings.language, 'yes') : t(settings.language, 'no'), inline: true },
      { name: t(settings.language, 'privacy_permissions'), value: ownData.permissions.map(item => t(settings.language, `permission_${item.permission}`)).join('\n') || t(settings.language, 'privacy_no_permissions'), inline: false }
    );
  }
  const description = `${notice}${notice ? '\n\n' : ''}${categoryTitle}`;
  const showCategories = !['language', 'language-options', 'privacy'].includes(category) && !category.startsWith('privacy-');
  const components = [...(showCategories ? [categoryButtons] : []), ...preferenceRows, footer];
  if (category === 'privacy' || category.startsWith('privacy-')) {
    const plainDetails = details.map(detail => `**${detail.name}**\n${detail.value}`).join('\n\n');
    const privacyEmbed = embed(t(settings.language, titleKey), `${description}${plainDetails ? `\n\n${plainDetails}` : ''}`);
    return { embeds: [privacyEmbed], components, flags: MessageFlags.Ephemeral };
  }
  return { embeds: [embed(`⚙️ Utils • ${t(settings.language, titleKey)}`, description).addFields(...details)], components, flags: MessageFlags.Ephemeral };
}

function languageConfirmationPayload(interaction, language, nonce, deadline) {
  return {
    embeds: [embed(t(language, 'language_confirm_title'), `${t(language, 'language_confirm_description')}\n\n${t(language, 'automatic_reset')} <t:${Math.ceil(deadline / 1000)}:R>.`, COLORS.warning)],
    components: [row(
      button(`user:language-confirm:${nonce}:${owner(interaction)}`, t(language, 'confirm_language'), ButtonStyle.Success),
      button(`user:language-cancel:${nonce}:${owner(interaction)}`, t(language, 'cancel'), ButtonStyle.Secondary)
    )],
    flags: MessageFlags.Ephemeral
  };
}

function timestampPayload(interaction, state) {
  const id = owner(interaction);
  const settings = database.getUser(id);
  const language = settings.language;
  const current = state || { zone: settings.timezone, date: '', time: '' };
  return { embeds: [embed(t(language, 'timestamp_title'), t(language, 'timestamp_intro')).addFields({ name: t(language, 'region_zone_result'), value: current.zone || '—', inline: true }, { name: t(language, 'local_date'), value: current.date || '—', inline: true }, { name: t(language, 'local_time'), value: current.time || '—', inline: true })], components: [row(button(`timestamp:zone:${id}`, t(language, 'choose_zone'), ButtonStyle.Secondary), button(`timestamp:date:${id}`, t(language, 'choose_date')), button(`timestamp:time:${id}`, t(language, 'choose_time'))), row(button(`timestamp:confirm:${id}`, t(language, 'run_timestamp'), ButtonStyle.Success).setDisabled(!current.date || !current.time), button(`tool:back:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function timestampZonePayload(interaction, selected = 'UTC') {
  const language = database.getUser(owner(interaction)).language;
  const options = zoneOptions(selected, language);
  return { embeds: [embed(t(language, 'timezone'), t(language, 'region_help')).addFields({ name: t(language, 'selected_zone'), value: selected })], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`timestamp:zone-select:${owner(interaction)}`).setPlaceholder(t(language, 'timezone')).addOptions(options)), back(`tool:back:${owner(interaction)}`, language)], flags: MessageFlags.Ephemeral };
}

function convertPayload(interaction, state) {
  const id = owner(interaction);
  const current = state || { date: '', time: '', source: 'Europe/Paris', target: database.getUser(id).timezone };
  const language = database.getUser(id).language;
  const options = zoneOptions(null, language);
  const sourceSelect = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:source:${id}`).setPlaceholder(t(language, 'source_zone')).addOptions(options));
  const targetSelect = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:target:${id}`).setPlaceholder(t(language, 'destination_zone')).addOptions(options));
  const description = `${t(language, 'conversion_intro')}\n\n${t(language, 'source_zone')}: **${current.source || '—'}**\n${t(language, 'destination_zone')}: **${current.target || '—'}**${current.target === database.getUser(id).timezone ? ` (${t(language, 'destination_default')})` : ''}\n${t(language, 'local_date')}: **${current.date || '—'}**\n${t(language, 'local_time')}: **${current.time || '—'}**`;
  return { embeds: [embed(t(language, 'conversion_title'), description)], components: [sourceSelect, targetSelect, row(button(`convert:date:${id}`, t(language, 'choose_date')), button(`convert:time:${id}`, t(language, 'choose_time'))), row(button(`convert:confirm:${id}`, t(language, 'run_conversion'), ButtonStyle.Success).setDisabled(!current.date || !current.time || !current.source || !current.target), button(`tool:back:${id}`, t(language, 'back_dashboard')))], flags: MessageFlags.Ephemeral };
}

function convertZonePayload(interaction, role, state) {
  const id = owner(interaction);
  const language = database.getUser(id).language;
  const selected = state[role];
  const key = role === 'source' ? 'source_zone' : 'destination_zone';
  return { embeds: [embed(t(language, 'conversion_title'), role === 'source' ? t(language, 'select_source') : t(language, 'select_destination')).addFields({ name: t(language, 'selected_zone'), value: selected })], components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`convert:zone-select:${role}:${id}`).setPlaceholder(t(language, key)).addOptions(zoneOptions(null, language))), row(button(`convert:zone-back:${id}`, t(language, 'back_categories')))], flags: MessageFlags.Ephemeral };
}

module.exports = { convertPayload, convertZonePayload, dashboardPayload, databasePayload, healthPayload, journalPayload, languageConfirmationPayload, managementPayload, permissionsPayload, presenceSettingsPayload, timestampPayload, timestampZonePayload, toolsPayload, userDataPayload, userPayload };
