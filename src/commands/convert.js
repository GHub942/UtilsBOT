const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { dateInputExample, formatLocal, formatOffset, getEquivalentZones, isSelectableZone, parseDateTime, resolveZone, timeInputExample } = require('../time');
const database = require('../database');
const panels = require('../panels');
const { t } = require('../i18n');

const drafts = new Map();

function getDraft(userId) {
  const current = drafts.get(userId);
  if (current) return current;
  const preferences = database.getUser(userId);
  return {
    date: '',
    time: '',
    source: preferences.timezone,
    target: preferences.timezone,
    language: preferences.language,
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
  const label = field === 'date' ? t(language, 'local_date') : t(language, 'local_time');
  const placeholder = field === 'date' ? dateInputExample(preferences) : timeInputExample(preferences);
  return new ModalBuilder()
    .setCustomId(`convert:field:${field}`)
    .setTitle(field === 'date' ? t(language, 'choose_date') : t(language, 'choose_time'))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(field).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
    ));
}

async function execute(interaction) {
  const draft = getDraft(interaction.user.id);
  if (interaction.isButton()) await interaction.update(panels.convertPayload(interaction, draft));
  else await interaction.reply(panels.convertPayload(interaction, draft));
  draft.origin = interaction;
  drafts.set(interaction.user.id, draft);
}

async function openField(interaction, field) {
  const draft = getDraft(interaction.user.id);
  return interaction.showModal(modal(field, draft.language, draft));
}

async function openZoneField(interaction, role) {
  const language = drafts.get(interaction.user.id)?.language || 'fr';
  const field = new TextInputBuilder()
    .setCustomId('zone')
    .setLabel(t(language, role === 'source' ? 'source_zone' : 'destination_zone'))
    .setPlaceholder('Europe/Paris')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const zoneModal = new ModalBuilder()
    .setCustomId(`convert:zone:modal:${role}`)
    .setTitle(t(language, 'custom_zone_modal'))
    .addComponents(new ActionRowBuilder().addComponents(field));
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
  const updated = await updateDraftMessage(interaction.user.id, panels.convertPayload(interaction, draft));
  if (!updated) return interaction.editReply({ content: t(draft.language, 'expired_flow') });
  return interaction.deleteReply();
}

async function handleModal(interaction) {
  const field = interaction.customId.split(':')[2];
  const draft = getDraft(interaction.user.id);
  draft[field] = interaction.fields.getTextInputValue(field).trim();
  return updateAfterModal(interaction, draft);
}

async function handleZoneModal(interaction) {
  const role = interaction.customId.split(':')[3];
  const value = interaction.fields.getTextInputValue('zone').trim();
  const language = drafts.get(interaction.user.id)?.language || 'fr';
  if (!['source', 'target'].includes(role) || !isSelectableZone(value)) {
    return interaction.reply({ content: `❌ ${t(language, 'invalid_zone')}`, flags: MessageFlags.Ephemeral });
  }
  const draft = getDraft(interaction.user.id);
  draft[role] = value;
  return updateAfterModal(interaction, draft);
}

function showAmbiguity(interaction, options, draft) {
  const language = draft.language || 'fr';
  draft.ambiguities = options;
  drafts.set(interaction.user.id, draft);
  const buttons = options.map((option, index) => new ButtonBuilder()
    .setCustomId(`convert:disambiguation:${index}:${interaction.user.id}`)
    .setLabel(`${index === 0 ? t(language, 'daylight_time') : t(language, 'standard_time')} (${formatOffset(option.offset)})`)
    .setStyle(ButtonStyle.Primary));
  return interaction.update({
    embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle(t(language, 'ambiguous_title')).setDescription(t(language, 'ambiguous_description'))],
    components: [new ActionRowBuilder().addComponents(buttons)]
  });
}

async function confirm(interaction) {
  const draft = getDraft(interaction.user.id);
  const language = draft.language || 'fr';
  if (!isSelectableZone(draft.source) || !isSelectableZone(draft.target)) {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌').setDescription(t(language, 'invalid_zone'))], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`convert:back:${interaction.user.id}`).setLabel(t(language, 'back_categories')).setStyle(ButtonStyle.Secondary))] });
  }
  const parsed = parseDateTime(`${draft.date} ${draft.time}`, draft.source, draft);
  if (parsed.ambiguous) return showAmbiguity(interaction, parsed.ambiguous, draft);
  if (parsed.error) {
    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌').setDescription(`${parsed.error}\n\n${t(language, 'date_examples')} \`${dateInputExample(draft)}\` ${t(language, 'local_time').toLowerCase()} \`${timeInputExample(draft)}\`.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`convert:date:${interaction.user.id}`).setLabel(t(language, 'correct_date')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`convert:time:${interaction.user.id}`).setLabel(t(language, 'choose_time')).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`convert:back:${interaction.user.id}`).setLabel(t(language, 'back_categories')).setStyle(ButtonStyle.Secondary)
      )]
    });
  }
  return renderConversion(interaction, parsed.dateTime, draft);
}

async function renderConversion(interaction, sourceDateTime, draft) {
  const language = draft.language || 'fr';
  if (!sourceDateTime?.isValid) {
    return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('❌').setDescription(t(language, 'expired_flow'))], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tool:timezone:${interaction.user.id}`).setLabel(t(language, 'restart')).setStyle(ButtonStyle.Primary))] });
  }
  const target = resolveZone(draft.target);
  const converted = sourceDateTime.setZone(target.zone);
  const equivalents = getEquivalentZones(converted, target).slice(0, 12);
  const seconds = Math.floor(converted.toUTC().toMillis() / 1000);
  if (interaction.guildId) database.addAudit(interaction.guildId, 'convert.create', interaction.user.id, `${draft.source} -> ${draft.target}`);
  drafts.delete(interaction.user.id);

  const result = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(t(language, 'converted'))
    .setDescription(t(language, 'conversion_summary'))
    .addFields(
      { name: `${t(language, 'source_result')} • ${draft.source}`, value: `${formatLocal(sourceDateTime, draft)} ${draft.source}`, inline: true },
      { name: `${t(language, 'target_result')} • ${draft.target}`, value: `${formatLocal(converted, draft)} ${draft.target}`, inline: true },
      { name: t(language, 'unix_value'), value: `\`${seconds}\``, inline: true },
      { name: t(language, 'equivalent_zones'), value: equivalents.join(', ') || '—', inline: false }
    );
  return interaction.update({ embeds: [result], components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`convert:again:${interaction.user.id}`).setLabel(t(language, 'restart')).setStyle(ButtonStyle.Primary)
  )] });
}

async function handleDisambiguation(interaction, index) {
  const draft = getDraft(interaction.user.id);
  const selected = draft.ambiguities?.[index];
  if (!selected) return interaction.update({ embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(draft.language, 'expired_flow'))], components: [] });
  return renderConversion(interaction, selected, draft);
}

module.exports = {
  execute,
  drafts,
  getDraft,
  handleModal,
  handleZoneModal,
  openField,
  openZoneField,
  confirm,
  handleDisambiguation,
  async again(interaction) {
    drafts.delete(interaction.user.id);
    return execute(interaction);
  }
};
