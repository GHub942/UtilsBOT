# TODO

This is the follow-up backlog; it is not a guarantee that an item is scheduled.

## T1 : Security and privacy

- Define a retention limit and cleanup policy for the audit log, which currently grows until an administrator resets or removes the database.
- Document a privacy request process for audit entries associated with deleted accounts.
- Review exported data and debug logging whenever new fields or event details are added.

## T2 : Reliability and operations

- Add automated integration coverage for Discord interaction flows and permission-denied cases.
- Add a documented, tested SQLite backup and restore procedure that handles WAL files safely.
- Consider a health/status command and operational metrics for unattended deployments.
- Add CI checks for the supported Node.js versions and dependency updates.

## T3 : Time tools

- Expand tests for ambiguous and nonexistent local times at daylight-saving transitions.
- Review the curated time-zone menu based on user feedback while retaining the custom IANA-zone entry.
- Add locale-aware preference options if additional languages are introduced.

## T4 : Languages
- Translate all the backend actually in French to English
- Add a translation for the BOT : English. The translation is choosed by the user in /dashboard utils