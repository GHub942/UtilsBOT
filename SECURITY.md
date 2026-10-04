# Security Policy

## Supported versions

Security fixes are provided for the latest version on the default branch. Use a supported Node.js release that meets the version requirement in `package.json`.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue. Use GitHub's private vulnerability reporting for this repository when it is enabled. If private reporting is unavailable, contact a repository maintainer privately through GitHub and share only the information needed to reproduce and assess the issue.

Include the affected version, impact, reproduction steps, and any suggested mitigation. Do not include real bot tokens, personal data, or production database files in a report.

## Deployment security

- Keep `.env`, SQLite databases, exports, and backups out of source control and restrict filesystem access to them.
- Run only one bot process against a given data directory; the bot enforces this with a process lock.
- Use a dedicated bot account and grant only the Discord permissions it needs.
- Only the server owner has implicit full access. Discord's `Manage Server` permission does not grant Utils access.
- Utils permissions can be assigned to individual members or roles. Assign role permissions carefully because every current and future member of the role inherits that access.
- Give Utils permissions only to trusted members. Only the owner can delegate permission management; delegated managers cannot grant permissions they do not hold or delegate the manager role.
- Role grants apply to every member whose interaction payload includes that role. Role IDs are resolved from both discord.js cached members and Discord's raw interaction-member role arrays.
- Presence monitoring requires the Discord privileged Presence Intent. It publishes selected member statuses and activities to the configured channel; use that channel's Discord visibility permissions to limit who can read the public embed. The refresh policy separately limits who can use its refresh button.
- Server reset requires a confirmation form with the exact uppercase phrase `RESET`. Other destructive data actions use a second confirmation that expires after five seconds.
- Interactions are rate limited per user; operational-status refreshes use a separate three-second cooldown.
- Store exported data securely and delete it when it is no longer needed.
- Set `LOG_LEVEL` to `debug` only when diagnosing an issue; review logs before sharing them.
- Rotate a bot token immediately if it is exposed, and update the deployment environment.

## Data handling

Guild permissions, settings, and audit records are stored locally in per-guild SQLite files. Personal preferences are stored in per-user SQLite files. The bot does not require message-content access. A user's preferences can be deleted through the dashboard; members can export or delete user data only when the relevant Utils permission is explicitly granted.

Audit records are retained for at most 180 days and capped at 10,000 entries per guild. Cleanup occurs when a new audit record is written. Deleting a user's Utils data also removes their explicit permission assignments and guild audit records that identify them as an actor or in record details.

For a privacy request, the user can review their stored settings and current-server Utils permissions at `/dashboard utils` under Preferences > Language & privacy > Privacy. They can separately delete their bot preferences or remove their own Utils permission assignments and identifying audit entries from the current server. A member with the explicit user-data management permission can also delete a selected user's Utils data. Requests concerning Discord account data held by Discord itself must be submitted to Discord; this bot only controls its own local database.

Use `npm run database -- backup <new-directory>` to create a SQLite-consistent snapshot outside `data/`. Stop the bot before `npm run database -- restore <backup-directory>`; restore acquires the single-instance lock and overlays databases without deleting files absent from the backup. See the README for operational details.

Exports may contain user and guild identifiers. Debug logs record interaction types, not user-provided values or message contents; still review logs and exports before sharing them.
