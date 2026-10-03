const { SlashCommandBuilder } = require('discord.js');
const { dashboardPayload, userPayload } = require('../panels');
const { canOpenServerDashboard } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Ouvre le tableau de bord de Utils')
    .addSubcommand(subcommand => subcommand
      .setName('utils')
      .setDescription('Gere Utils pour ce serveur ou ton compte')),

  async execute(interaction) {
    await interaction.reply(canOpenServerDashboard(interaction) ? dashboardPayload(interaction) : userPayload(interaction));
  }
};
