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
- Give Utils permissions only to trusted members. Permission management and server reset are sensitive administrative capabilities.
- Store exported data securely and delete it when it is no longer needed.
- Set `LOG_LEVEL` to `debug` only when diagnosing an issue; review logs before sharing them.
- Rotate a bot token immediately if it is exposed, and update the deployment environment.

## Data handling

Guild permissions, settings, and audit records are stored locally in per-guild SQLite files. Personal preferences are stored in per-user SQLite files. The bot does not require message-content access. A user's preferences can be deleted through the dashboard; authorized server administrators can export or delete user data where the relevant Utils permission is granted.
