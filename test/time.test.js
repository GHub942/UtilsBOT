const assert = require('node:assert/strict');
const test = require('node:test');
const { DateTime } = require('luxon');
const {
  arrivalModesForDate,
  dateInputExample,
  discordTimestampFormats,
  formatLocal,
  isSelectableZone,
  parseDateTime,
  resolveZone,
  timeInputExample
} = require('../src/time');

test('resolves IANA zones and valid fixed offsets within the UTC range', () => {
  assert.equal(resolveZone('Europe/Paris').canonical, 'Europe/Paris');
  assert.equal(resolveZone('UTC+14:00').canonical, 'UTC+14:00');
  assert.equal(resolveZone('UTC-14:00').canonical, 'UTC-14:00');
  assert.equal(resolveZone('UTC+14:01'), null);
  assert.equal(resolveZone('Invalid/Zone'), null);
});

test('offers fixed named zones and IANA zones but not UTC/GMT formats', () => {
  for (const zone of ['CET', 'CEST', 'Europe/Paris', 'America/New_York']) assert.equal(isSelectableZone(zone), true);
  for (const zone of ['UTC', 'GMT', 'UTC+01:00', 'Etc/GMT-1', 'SystemV/EST5']) assert.equal(isSelectableZone(zone), false);
});

test('parses local dates using the selected preference format', () => {
  const dmy = parseDateTime('31/03/2026 14:30', 'Europe/Paris', { dateFormats: ['DMY'] });
  const mdy = parseDateTime('03/31/2026 14:30', 'UTC', { dateFormats: ['MDY'] });

  assert.equal(dmy.dateTime.toFormat('yyyy-MM-dd HH:mm'), '2026-03-31 14:30');
  assert.equal(mdy.dateTime.toFormat('yyyy-MM-dd HH:mm'), '2026-03-31 14:30');
  assert.equal(parseDateTime('not a date', 'UTC').error.startsWith('Date invalide'), true);
  assert.match(parseDateTime('31/03/2026 14:30', 'Invalid/Zone').error, /Fuseau inconnu/);
});

test('keeps seasonal destination choices around a daylight-saving transition', () => {
  const nearTransition = DateTime.fromObject({ year: 2026, month: 3, day: 29, hour: 12 }, { zone: 'Europe/Paris' });
  assert.deepEqual(arrivalModesForDate(nearTransition).sort((a, b) => a - b), [60, 120]);
});

test('requires an explicit choice for ambiguous local time at the daylight-saving fold', () => {
  const ambiguous = parseDateTime('25/10/2026 02:30', 'Europe/Paris');
  assert.equal(ambiguous.ambiguous.length, 2);
  assert.deepEqual(ambiguous.ambiguous.map(value => value.offset), [120, 60]);
  assert.equal(parseDateTime('25/10/2026 02:30', 'Europe/Paris', { disambiguation: 0 }).dateTime.offset, 120);
  assert.equal(parseDateTime('25/10/2026 02:30', 'Europe/Paris', { disambiguation: 1 }).dateTime.offset, 60);
  assert.match(parseDateTime('25/10/2026 02:30', 'Europe/Paris', { disambiguation: 4 }).error, /selection/);
});

test('rejects nonexistent local time at the daylight-saving gap', () => {
  const result = parseDateTime('29/03/2026 02:30', 'Europe/Paris');
  assert.match(result.error, /n’existe pas/);
});

test('builds examples and all Discord timestamp formats', () => {
  assert.equal(dateInputExample({ dateFormats: ['YMD'], dateSeparator: '-' }), '2026-09-03');
  assert.equal(dateInputExample({ isoDates: true }), '2026-09-03');
  assert.equal(timeInputExample({ timeFormats: ['HM'], timeSeparator: '.', showSeconds: false }), '14.30');
  assert.deepEqual(Object.keys(discordTimestampFormats(1)), ['d', 'D', 't', 'T', 'f', 'F', 'R']);
});

test('formats tool results using the selected date, time, and ISO preferences', () => {
  const value = DateTime.fromObject({ year: 2026, month: 3, day: 31, hour: 14, minute: 30, second: 5 }, { zone: 'Europe/Paris' });
  assert.equal(formatLocal(value, { dateFormats: ['YMD'], dateSeparator: '.', timeFormats: ['HM'], timeSeparator: '.', showSeconds: true }), '2026.03.31 14.30');
  assert.equal(formatLocal(value, { isoDates: true, timeFormats: ['HMS'] }), '2026-03-31T14:30:05');
});
