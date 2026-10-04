const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { dateInputExample, discordTimestampFormats, formatLocal, isSelectableZone, normalizeDateInput, normalizeTimeInput, parseDateTime, timeInputExample } = require('../time');
const database = require('../database');
const panels = require('../panels');
const { t } = require('../i18n');

const drafts = new Map();
const FORMAT_LABELS = {
  d: 'day_short',
  D: 'day_long',
  t: 'time_short',
  T: 'time_long',
  f: 'date_time',
  F: 'full_date_time',
  R: 'relative_time'
};

function getDraft(userId) {
  const current = drafts.get(userId);
  if (current) return current;
  const preferences = database.getUser(userId);
  return {
    zone: preferences.timezone,
    language: preferences.language,
    date: '',
    time: '',
    dateFormats: preferences.dateFormats,
    timeFormats: preferences.timeFormats,
    dateSeparator: preferences.dateSeparator,
    timeSeparator: preferences.timeSeparator,
    isoDates: preferences.isoDates,
    showSeconds: preferences.showSeconds,
    origin: null
  };
}

function modal(field, language, preferences) {
  const isDate = field === 'date';
  return new ModalBuilder()
    .setCustomId(`timestamp:field:${field}`)
    .setTitle(t(language, isDate ? 'choose_date' : 'choose_time'))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(field)
        .setLabel(t(language, isDate ? 'local_date' : 'local_time'))
        .setPlaceholder(isDate ? dateInputExample(preferences) : timeInputExample(preferences))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true)
    ));
}

async function execute(interaction) {
  const draft = getDraft(interaction.user.id);
  const payload = panels.timestampPayload(interaction, draft);
  if (interaction.isButton()) await interaction.update(payload);
  else await interaction.reply(payload);
  draft.origin = interaction;
  drafts.set(interaction.user.id, draft);
}

async function openField(interaction, field) {
  const draft = getDraft(interaction.user.id);
  return interaction.showModal(modal(field, draft.language, draft));
}

async function openZoneField(interaction) {
  const language = drafts.get(interaction.user.id)?.language || 'fr';
  const input = new TextInputBuilder()
    .setCustomId('zone')
    .setLabel(t(language, 'custom_zone'))
    .setPlaceholder('Europe/Paris')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const zoneModal = new ModalBuilder()
    .setCustomId('timestamp:zone:modal')
    .setTitle(t(language, 'custom_zone_modal'))
    .addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(zoneModal);
}

async function updateDraftMessage(userId, payload) {
  const draft = drafts.get(userId);
  if (!draft?.origin) return false;
  try {
    await draft.origin.editReply(payload);
    return true;
  } catch (error) {
    if (error.code !== 10008 && error.code !== 10062) throw error;
    draft.origin = null;
    return false;
  }
}

async function updateAfterModal(interaction, draft) {
  drafts.set(interaction.user.id, draft);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await updateDraftMessage(interaction.user.id, panels.timestampPayload(interaction, draft));
  if (!updated) return interaction.editReply({ content: t(draft.language, 'expired_flow') });
  return interaction.deleteReply();
}

async function handleModal(interaction) {
  const field = interaction.customId.split(':')[2];
  const draft = getDraft(interaction.user.id);
  const value = interaction.fields.getTextInputValue(field).trim();
  draft[field] = field === 'date' ? normalizeDateInput(value, draft) : normalizeTimeInput(value);
  return updateAfterModal(interaction, draft);
}

async function handleZoneModal(interaction) {
  const value = interaction.fields.getTextInputValue('zone').trim();
  const language = drafts.get(interaction.user.id)?.language || 'fr';
  if (!isSelectableZone(value)) {
    return interaction.reply({ content: `❌ ${t(language, 'invalid_zone')}`, flags: MessageFlags.Ephemeral });
  }
  const draft = getDraft(interaction.user.id);
  draft.zone = value;
  return updateAfterModal(interaction, draft);
}

function showAmbiguity(interaction, options, draft) {
  const language = draft.language || 'fr';
  draft.ambiguities = options;
  drafts.set(interaction.user.id, draft);
  const buttons = options.map((option, index) => new ButtonBuilder()
    .setCustomId(`timestamp:disambiguation:${index}:${interaction.user.id}`)
    .setLabel(`${index === 0 ? t(language, 'daylight_time') : t(language, 'standard_time')} (${option.toFormat('ZZ')})`)
    .setStyle(ButtonStyle.Primary));
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(t(language, 'ambiguous_title')).setDescription(t(language, 'ambiguous_description'))],
    components: [new ActionRowBuilder().addComponents(buttons)]
  });
}

async function confirm(interaction) {
  const draft = getDraft(interaction.user.id);
  const language = draft.language || 'fr';
  const parsed = parseDateTime(`${draft.date} ${draft.time}`, draft.zone, draft);
  if (parsed.ambiguous) return showAmbiguity(interaction, parsed.ambiguous, draft);
  if (parsed.error) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(t(language, 'missing_title')).setDescription(`${parsed.error}\n\n${t(language, 'date_examples')} \`${dateInputExample(database.getUser(interaction.user.id))}\` ${t(language, 'local_time').toLowerCase()} \`${timeInputExample(database.getUser(interaction.user.id))}\`.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`timestamp:date:${interaction.user.id}`).setLabel(t(language, 'correct_date')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`timestamp:time:${interaction.user.id}`).setLabel(t(language, 'choose_time')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`timestamp:zone:${interaction.user.id}`).setLabel(t(language, 'choose_zone')).setStyle(ButtonStyle.Primary)
      )]
    });
  }
  return renderTimestamp(interaction, parsed.dateTime, draft);
}

async function renderTimestamp(interaction, dateTime, draft) {
  const language = draft.language || 'fr';
  if (!dateTime?.isValid) {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(language, 'expired_flow'))], components: [] });
  }
  const seconds = Math.floor(dateTime.toUTC().toMillis() / 1000);
  const formats = discordTimestampFormats(seconds);
  const lines = Object.entries(formats).map(([style, formula]) => `**${t(language, FORMAT_LABELS[style])}** \`${formula}\``).join('\n');
  if (interaction.guildId) database.addAudit(interaction.guildId, 'timestamp.create', interaction.user.id, draft.zone);
  drafts.delete(interaction.user.id);

  const result = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(t(language, 'timestamp_created'))
    .setDescription(t(language, 'timestamp_intro'))
    .addFields(
      { name: t(language, 'local_date'), value: `${formatLocal(dateTime, draft)} ${draft.zone}`, inline: true },
      { name: t(language, 'timestamp_preview'), value: `<t:${seconds}:F>`, inline: true },
      { name: t(language, 'timestamp_unix'), value: `\`${seconds}\``, inline: true },
      { name: t(language, 'timestamp_formats'), value: lines, inline: false }
    );
  return interaction.update({ embeds: [result], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`timestamp:again:${interaction.user.id}`).setLabel(t(language, 'another_timestamp')).setStyle(ButtonStyle.Primary)
  )] });
}

async function handleDisambiguation(interaction, index) {
  const draft = getDraft(interaction.user.id);
  const selected = draft.ambiguities?.[index];
  if (!selected) {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(draft.language, 'expired_flow'))], components: [] });
  }
  return renderTimestamp(interaction, selected, draft);
}

module.exports = {
  execute,
  confirm,
  drafts,
  getDraft,
  handleModal,
  handleZoneModal,
  handleDisambiguation,
  openField,
  openZoneField,
  updateDraftMessage,
  async again(interaction) {
    drafts.delete(interaction.user.id);
    return execute(interaction);
  }
};
