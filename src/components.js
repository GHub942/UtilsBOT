const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const ZONES = [
  ['CET', 'Fixed Central European Standard Time (+01:00)'],
  ['CEST', 'Fixed Central European Summer Time (+02:00)'],
  ['EST', 'Fixed Eastern Standard Time (-05:00)'],
  ['EDT', 'Fixed Eastern Daylight Time (-04:00)'],
  ['PST', 'Fixed Pacific Standard Time (-08:00)'],
  ['PDT', 'Fixed Pacific Daylight Time (-07:00)'],
  ['Europe/Paris', 'Paris, Brussels, Madrid'],
  ['Europe/London', 'London, Lisbon'],
  ['America/New_York', 'New York, Toronto'],
  ['America/Los_Angeles', 'Los Angeles, Vancouver'],
  ['America/Chicago', 'Chicago, Mexico City'],
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
