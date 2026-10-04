const fs = require('fs');
const path = require('path');
const { Client, Collection, EmbedBuilder, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { handleInteraction } = require('./interactions');
const database = require('./database');
const { t } = require('./i18n');
const { acquireProcessLock } = require('./process-lock');
const presenceMonitor = require('./presence-monitor');
const { isDisallowedIntentsError } = require('./gateway');

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

const commandsPath = path.join(__dirname, 'commands');
const commandModules = fs.readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'))
  .map(file => require(path.join(commandsPath, file)))
  .filter(command => command.data);
let client;

function closeResources() {
  client?.destroy();
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

function createClient(withPresenceIntent) {
  const intents = [GatewayIntentBits.Guilds];
  if (withPresenceIntent) intents.push(GatewayIntentBits.GuildPresences);
  const activeClient = new Client({ intents });
  activeClient.commands = new Collection();
  for (const command of commandModules) activeClient.commands.set(command.data.name, command);

  activeClient.once(Events.ClientReady, readyClient => {
    logger.info(`Utils logged in as ${readyClient.user.tag}.`);
    if (withPresenceIntent) presenceMonitor.start(activeClient, logger);
    else {
      logger.info('Presence monitoring is disabled. Set PRESENCE_MONITOR_ENABLED=true after enabling the Presence Intent in the Discord Developer Portal.');
      presenceMonitor.pause(activeClient, logger).catch(error => logger.error('Could not pause presence monitoring', error.stack || error.message));
    }
  });

  activeClient.on(Events.InteractionCreate, interaction => {
    const interactionType = interaction.isChatInputCommand()
      ? `/${interaction.commandName}`
      : interaction.customId
        ? interaction.customId.split(':').slice(0, 2).join(':')
        : 'unknown';
    logger.debug('Interaction received', interactionType);
    handleInteraction(activeClient, interaction).catch(error => {
      if (error.code === 10062 || error.code === 40060) {
        logger.warn('Interaction expired or already acknowledged', `${interactionType} (${error.code})`);
        return;
      }
      logger.error('Interaction error', error.stack || error.message);
      if (interaction.isRepliable()) {
        const language = interaction.locale?.startsWith('fr') ? 'fr' : 'en';
        const payload = { embeds: [new EmbedBuilder().setColor(0xed4245).setDescription(t(language, 'generic_error'))], flags: MessageFlags.Ephemeral };
        const response = interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
        response.catch(responseError => logger.warn('Could not report the interaction error to the user', responseError.stack || responseError.message));
      }
    });
  });

  if (withPresenceIntent) {
    activeClient.on(Events.ShardDisconnect, closeEvent => {
      if (isDisallowedIntentsError({ code: closeEvent.code, message: closeEvent.reason })) {
        fallbackWithoutPresence(activeClient);
      }
    });
  }

  return activeClient;
}

function fallbackWithoutPresence(activeClient) {
  if (client !== activeClient) return;
  logger.warn('Discord denied the privileged Presence Intent. Retrying without presence monitoring. Enable the intent in the Developer Portal to use this feature.');
  activeClient.destroy();
  presenceMonitor.setAvailable(false);
  connect(false);
}

async function connect(withPresenceIntent) {
  const activeClient = createClient(withPresenceIntent);
  client = activeClient;
  try {
    await activeClient.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    if (client !== activeClient) return;
    if (withPresenceIntent && isDisallowedIntentsError(error)) {
      fallbackWithoutPresence(activeClient);
      return;
    }
    logger.error('Could not connect to Discord', error.stack || error.message);
    closeResources();
    process.exitCode = 1;
  }
}

const presenceIntentEnabled = process.env.PRESENCE_MONITOR_ENABLED?.trim().toLowerCase() === 'true';
connect(presenceIntentEnabled);
