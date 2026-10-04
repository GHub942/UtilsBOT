const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { t } = require('./i18n');

const ZONES = [
  ['Europe/Paris', 'Paris, Brussels, Madrid'],
  ['Europe/London', 'London, Dublin, Lisbon'],
  ['Europe/Berlin', 'Berlin, Rome, Madrid'],
  ['America/New_York', 'New York, Toronto'],
  ['America/Chicago', 'Chicago, Mexico City'],
  ['America/Los_Angeles', 'Los Angeles, Vancouver'],
  ['America/Sao_Paulo', 'Sao Paulo, Buenos Aires'],
  ['Asia/Dubai', 'Dubai, Abu Dhabi'],
  ['Asia/Kolkata', 'New Delhi, Mumbai'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney, Melbourne']
];

function zoneOptions(selected, language = 'fr') {
  return [
    ['UTC', t(language, 'zone_utc_description')],
    ['GMT', t(language, 'zone_gmt_description')],
    ...ZONES
  ].map(([value, description]) => ({
    label: value,
    value,
    description,
    default: value === selected
  }));
}

function zoneSelect(customId, placeholder, selected, language = 'fr') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(zoneOptions(selected, language))
  );
}

function dateButton(customId, language = 'fr') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(t(language, 'date_enter')).setStyle(ButtonStyle.Primary)
  );
}

module.exports = { dateButton, zoneSelect, zoneOptions, ZONES };
