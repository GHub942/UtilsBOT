const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { handleInteraction } = require('./interactions');
const database = require('./database');
const { t } = require('./i18n');
const { acquireProcessLock } = require('./process-lock');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('The .env file is missing. Copy .env.example to .env and configure the bot.');
    process.exit(1);
  }
  throw error;
}
const logger = require('./logger');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing from the .env file.');
  process.exit(1);
}

let releaseProcessLock;
try {
  releaseProcessLock = acquireProcessLock(path.join(__dirname, '..', 'data', 'bot.pid'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
process.once('exit', releaseProcessLock);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, readyClient => {
  logger.info(`Utils logged in as ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, interaction => {
  const interactionType = interaction.isChatInputCommand()
    ? `/${interaction.commandName}`
    : interaction.customId
      ? interaction.customId.split(':').slice(0, 2).join(':')
      : 'unknown';
  logger.debug('Interaction received', interactionType);
  handleInteraction(client, interaction).catch(error => {
    if (error.code === 10062 || error.code === 40060) {
      logger.warn('Interaction expired or already acknowledged', `${interactionType} (${error.code})`);
      return;
    }
    logger.error('Erreur interaction', error.stack || error.message);
    if (interaction.isRepliable()) {
      const language = interaction.locale?.startsWith('fr') ? 'fr' : 'en';
      const payload = { content: t(language, 'generic_error'), flags: MessageFlags.Ephemeral };
      const response = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
      response.catch(responseError => logger.warn('Could not report the interaction error to the user', responseError.stack || responseError.message));
    }
  });
});

function closeResources() {
  client.destroy();
  database.closeAll();
}

process.once('SIGINT', () => {
  logger.info('Shutdown requested.');
  closeResources();
});
process.once('SIGTERM', () => {
  logger.info('Shutdown requested.');
  closeResources();
});

process.on('unhandledRejection', error => {
  logger.error('Unhandled promise rejection', error?.stack || String(error));
  process.exitCode = 1;
  closeResources();
});
process.on('uncaughtException', error => {
  logger.error('Uncaught exception', error.stack || error.message);
  closeResources();
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  logger.error('Could not connect to Discord', error.stack || error.message);
  closeResources();
  process.exitCode = 1;
});
