# TODO

This is the follow-up backlog; it is not a guarantee that an item is scheduled.

## T1 : Security and privacy

- [x] Define a 180-day retention limit and 10,000-entry cap for the audit log, cleaned on audit writes.
- [x] Document the privacy request process and remove matching audit and permission records when account data or current-server permissions are deleted.
- [x] Review export contents and ensure interaction debug logs avoid user-provided values.

## T2 : Reliability and operations

- [x] Add automated coverage for modal interaction acknowledgement and permission-denied flows.
- [x] Add a documented, tested SQLite online-backup and restore procedure that handles WAL files safely.
- [x] Add a dashboard health/status view with uptime, gateway latency, and audit-log size.
- [x] Add multi-select member and action filters to the audit journal, preserving filters across pagination and export.
- [x] Add CI checks for supported Node.js versions and automated dependency update proposals.

## T3 : Time tools

- [x] Test ambiguous and nonexistent local times at daylight-saving transitions.
- [x] Curate the region menu to ten IANA cities plus UTC/GMT, while accepting supported IANA, fixed-abbreviation, and UTC/GMT-offset values through custom input.
- [x] Add a French/English preference control as the basis for localized settings and tools.

## T4 : Languages
- [x] Translate all remaining French backend messages and administrative panels to English.
- [x] Add English translations for preference categories and the time tools, selectable from `/dashboard utils`.
- [x] Complete and audit the English translation of every user-facing bot message.