# UtilsBOT

UtilsBOT is a Discord utility bot for timestamp creation and time-zone conversion. Its user-facing tools are available privately through `/dashboard utils`.

## Requirements

- Node.js 22.5 or newer
- A Discord application and bot token
- A Discord server where the bot can use application commands

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_TOKEN` and `CLIENT_ID` in `.env`. Optionally set `GUILD_ID` to deploy commands to one development server.
3. Install dependencies with `npm ci`.
4. Register the slash command with `npm run deploy`.
5. Start the bot with `npm start`.

The global command registration can take time to appear in Discord. Setting `GUILD_ID` deploys to that server for development and removes the bot's managed global command copies, avoiding duplicate global and server-specific entries. Other global commands registered for the application are preserved. When changing back to global deployment, unset `GUILD_ID` and run `npm run deploy` again.

The `start.bat` and `start.sh` launchers perform dependency installation when needed, deploy the application command, and ask whether to enable DEBUG logs for that run. They restart the bot after a crash, up to five times. The bot uses `data/bot.pid` to prevent multiple instances from using the same SQLite databases; stop an existing instance before starting another. The launchers create `.env` from `.env.example` if it does not exist; configure the file and run the launcher again.

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | Yes | Application ID from the Discord Developer Portal |
| `GUILD_ID` | No | Development server ID; omit for global command registration |
| `LOG_LEVEL` | No | `error`, `warn`, `info` (default), or `debug`; launchers override it for the current run |

## Features

- `/dashboard utils` opens personal preferences, timestamp creation, time-zone conversion, and—when authorized—server management.
- Timestamp creation displays a Discord preview, Unix timestamp, and copy-ready Discord formats.
- Time-zone conversion handles IANA time zones, fixed UTC offsets, seasonal offsets, and daylight-saving transitions.
- Preference controls are grouped by region, dates, times, and language/privacy. Language previews show a relative reset time and require confirmation within 10 seconds.
- The region menu offers curated city-based IANA zones, one UTC/GMT option, and an “Other time zone...” select option. The custom option remains available regardless of the current zone. Custom input accepts supported IANA zones, fixed abbreviations, and UTC/GMT offsets.
- Choosing UTC/GMT saves an automatic display preference: UTC is shown in Central European winter, GMT in summer, and both represent a fixed +00:00 offset.
- Time conversion asks for both source and destination zones. The destination initially follows the user's saved time-zone preference.
- Timestamp input pads short dates, expands two-digit years, and fills in omitted seconds.
- Only the guild owner has implicit full access. Every other member, including members with Discord's `Manage Server` permission, must be explicitly granted the relevant Utils permission.
- Data exports and the audit journal are available only to members with the corresponding Utils permission.
- The server audit journal can be filtered by multiple members and action types at once; pagination and JSON export preserve the active filters.
- User-data and self-service deletions require a second confirmation within five seconds; cancelling returns to the preceding confirmation screen. Server reset requires the exact `RESET` confirmation phrase.
- Bot responses, including user-data views, administrative panels, exports, and errors, use embeds.
- Every interaction has a one-second per-user cooldown. Operational-status refresh has an additional three-second per-user cooldown.
- The operational status view reports readiness, Discord-relative uptime, gateway latency, aggregate server/member counts, shards, loaded commands, Node.js version, process memory, and current-server audit-log size. It can be refreshed and excludes credentials and individual user data.
- Server owners and Utils permission managers can configure a public presence monitor for up to five selected members. The bot posts one embed in the chosen text channel, showing each selected member's online/idle/do-not-disturb/offline state, current activity, and the approximate time they have been online. It refreshes every five minutes and includes a manual refresh button.
- The presence monitor's refresh policy can be set to holders of the `view_presence` Utils permission, the server owner, nobody, or everyone. This policy controls who can use the refresh button; who can read the published embed is controlled by the selected Discord channel's normal visibility permissions.

The removed `/timezone` and `/timestamp` application commands are not registered. Use the corresponding tools under `/dashboard utils`.

## Permissions

Only explicit Utils permissions are used for delegated access; there is no whitelist. Existing whitelist records are removed the first time a guild database is opened after this update. Whitelist-derived access is not migrated: grant any required access again through the permissions panel.

The guild owner has all Utils permissions and can assign any grantable permission, including permission management, to individual members or server roles. Other members receive only permissions explicitly assigned by the owner. Role permissions apply to all current and future members of the role. A delegated permission manager can grant or revoke only permissions they themselves hold; only the owner can delegate or revoke permission management. Discord's `Manage Server` permission does not grant Utils access.

Presence monitoring uses Discord's privileged **Presence Intent**. Enable it in the Discord Developer Portal under the bot's Privileged Gateway Intents before starting the bot. The bot stores the selected member IDs, channel/message IDs, refresh policy, and observed online start times in that guild's local settings. Use a restricted text channel if the status information should not be visible to everyone on the server. Disabling the monitor removes its published message.

Server reset requires two steps: an authorized member opens the confirmation form and enters the exact uppercase text `RESET`.

## Storage and privacy

The bot stores guild data in `data/guilds/<guild-id>/data.sqlite` and personal preferences in `data/users/<user-id>/data.sqlite`. Guild databases include explicit permissions, server settings, and an audit log. User databases contain preferences. SQLite uses write-ahead logging.

Users can view their own stored preferences and current-server Utils permissions in an embed under Preferences > Language & privacy > Privacy. They can separately delete bot preferences or remove their assigned Utils permissions and identifying audit entries from the current server. These self-service actions do not affect permissions granted on other servers. Self-service and user-data deletion use a second confirmation that expires after five seconds; cancelling returns to the preceding screen. Server reset instead requires the exact uppercase phrase `RESET`. Server members can export or delete another user's data only when explicitly assigned the corresponding Utils permission. Keep `.env` and the `data/` directory private, restrict access to backups, and never commit tokens or database files.

## Database backups

Run backups to a new directory outside `data/`; the SQLite online backup API creates a consistent snapshot of each database, including databases currently using WAL:

```sh
npm run database -- backup ../utilsbot-backup-2026-10-04
```

Restore overlays databases from an existing backup and requires the bot to be stopped. The script takes the bot process lock and refuses to restore while another bot instance is running:

```sh
npm run database -- restore ../utilsbot-backup-2026-10-04
```

Restore does not delete live databases absent from the backup. Keep backups access-controlled, test restores periodically, and store copies separately from the bot host.

The `scripts/database.js` program is an operator utility invoked by `npm run database`; the bot does not load it during normal startup.

## Development and tests

```sh
npm ci
npm test
```

Tests use Node's built-in test runner. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidance and [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.
