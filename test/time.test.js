const assert = require('node:assert/strict');
const test = require('node:test');
const { DateTime } = require('luxon');
const {
  arrivalModesForDate,
  dateInputExample,
  discordTimestampFormats,
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
  assert.deepEqual(arrivalModesForDate(nearTransition).sort(), ['GMT', 'UTC']);
});

test('builds examples and all Discord timestamp formats', () => {
  assert.equal(dateInputExample({ dateFormats: ['YMD'], dateSeparator: '-' }), '2026-09-03');
  assert.equal(timeInputExample({ timeFormats: ['HM'], timeSeparator: '.', showSeconds: false }), '14.30');
  assert.deepEqual(Object.keys(discordTimestampFormats(1)), ['d', 'D', 't', 'T', 'f', 'F', 'R']);
});
