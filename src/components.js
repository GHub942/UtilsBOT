const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const ZONES = [
  ['UTC', 'UTC'],
  ['UTC+1', 'Paris en hiver'],
  ['UTC+2', 'Paris en ete'],
  ['Europe/Paris', 'Paris, Bruxelles, Madrid'],
  ['Europe/London', 'Londres, Lisbonne'],
  ['America/New_York', 'New York, Toronto'],
  ['America/Los_Angeles', 'Los Angeles, Vancouver'],
  ['America/Chicago', 'Chicago, Mexico'],
  ['America/Sao_Paulo', 'Sao Paulo'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'New Delhi, Mumbai'],
  ['Asia/Shanghai', 'Shanghai, Beijing'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney']
];

function zoneOptions(selected) {
  return ZONES.map(([value, description]) => ({ label: value, value, description, default: value === selected }));
}

function zoneSelect(customId, placeholder, selected) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(zoneOptions(selected))
  );
}

function dateButton(customId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel('Saisir la date').setStyle(ButtonStyle.Primary)
  );
}

module.exports = { dateButton, zoneSelect, ZONES };
