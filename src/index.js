const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { handleInteraction } = require('./interactions');
const database = require('./database');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('Le fichier .env est introuvable. Copie .env.example vers .env puis configure le bot.');
    process.exit(1);
  }
  throw error;
}
const logger = require('./logger');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN manquant dans le fichier .env.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, readyClient => {
  logger.info(`Utils connecte en tant que ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, interaction => {
  const interactionType = interaction.isChatInputCommand()
    ? `/${interaction.commandName}`
    : interaction.customId
      ? interaction.customId.split(':').slice(0, 2).join(':')
      : 'unknown';
  logger.debug('Interaction reçue', interactionType);
  handleInteraction(client, interaction).catch(error => {
    logger.error('Erreur interaction', error.stack || error.message);
    if (interaction.isRepliable()) {
      const payload = { content: 'Une erreur est survenue. Consulte les logs du bot.', flags: MessageFlags.Ephemeral };
      const response = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
      response.catch(responseError => logger.warn('Impossible de signaler l’erreur à l’utilisateur', responseError.stack || responseError.message));
    }
  });
});

function closeResources() {
  client.destroy();
  database.closeAll();
}

process.once('SIGINT', () => {
  logger.info('Arrêt demandé.');
  closeResources();
});
process.once('SIGTERM', () => {
  logger.info('Arrêt demandé.');
  closeResources();
});

process.on('unhandledRejection', error => {
  logger.error('Promesse non geree', error?.stack || String(error));
  process.exitCode = 1;
  closeResources();
});
process.on('uncaughtException', error => {
  logger.error('Exception non geree', error.stack || error.message);
  closeResources();
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  logger.error('Connexion Discord impossible', error.stack || error.message);
  closeResources();
  process.exitCode = 1;
});
