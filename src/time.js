const { DateTime, FixedOffsetZone, IANAZone } = require('luxon');

const FIXED_ALIASES = new Map([
  ['UTC', 0],
  ['GMT', 0],
  ['UTC+0', 0],
  ['UTC+00:00', 0],
  ['GMT+0', 0],
  ['GMT+00:00', 0],
  ['UTC+1', 60],
  ['UTC+01:00', 60],
  ['GMT+1', 60],
  ['GMT+01:00', 60],
  ['UTC-1', -60],
  ['UTC-01:00', -60],
  ['GMT-1', -60],
  ['GMT-01:00', -60],
  ['CET', 60],
  ['CEST', 120],
  ['EET', 120],
  ['EST', -300],
  ['EDT', -240],
  ['PST', -480],
  ['PDT', -420],
  ['BST', 60]
]);

function normalizeZoneName(input) {
  return String(input || '').trim().toUpperCase();
}

function resolveZone(input) {
  const name = String(input || '').trim();
  const normalized = normalizeZoneName(name);
  if (FIXED_ALIASES.has(normalized)) {
    const minutes = FIXED_ALIASES.get(normalized);
    return { zone: FixedOffsetZone.instance(minutes), label: name || 'UTC', canonical: `UTC${formatOffset(minutes)}` };
  }
  const offsetMatch = /^(UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized);
  if (offsetMatch) {
    const hours = Number(offsetMatch[3]);
    const minutesPart = Number(offsetMatch[4] || 0);
    if ((hours < 14 && minutesPart < 60) || (hours === 14 && minutesPart === 0)) {
      const minutes = (hours * 60 + minutesPart) * (offsetMatch[2] === '-' ? -1 : 1);
      return { zone: FixedOffsetZone.instance(minutes), label: name, canonical: `UTC${formatOffset(minutes)}` };
    }
  }
  if (!IANAZone.isValidZone(name)) return null;
  return { zone: name, label: name, canonical: name };
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const remainder = absolute % 60;
  return `${sign}${hours}:${String(remainder).padStart(2, '0')}`;
}

function dateInputExample(preferences = {}) {
  const format = preferences.dateFormats?.[0] || 'DMY';
  const separator = preferences.dateSeparator || '/';
  const parts = format === 'YMD' ? ['2026', '09', '03'] : format === 'MDY' ? ['09', '03', '2026'] : ['03', '09', '2026'];
  return parts.join(separator);
}

function timeInputExample(preferences = {}) {
  const format = preferences.timeFormats?.[0] || 'HMS';
  if (format === 'TEXT') return preferences.showSeconds === false ? '14h 30m' : '14h 30m 00s';
  const separator = preferences.timeSeparator || ':';
  return ['14', '30', ...(preferences.showSeconds === false || format === 'HM' ? [] : ['00'])].join(separator);
}

function parseDateTime(input, zoneInput, preferences = {}) {
  const zoneInfo = resolveZone(zoneInput || 'UTC');
  if (!zoneInfo) return { error: `Fuseau inconnu : ${zoneInput}` };
  const value = String(input || '').trim();
  let dateTime;
  const isoValue = value.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  const iso = DateTime.fromISO(isoValue, { zone: zoneInfo.zone, setZone: false });
  if (iso.isValid && (/T|Z|[+-]\d{2}:?\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}[ T]/.test(value))) {
    dateTime = iso;
  } else {
    const dateMatch = /^(\d{1,4})[.,/-](\d{1,4})[.,/-](\d{1,4})[ ,T]+(.+)$/.exec(value);
    if (!dateMatch) return { error: 'Date invalide. Utilise JJ/MM/AAAA HH:mm ou ISO 8601.' };
    const timeMatch = /^(\d{1,2})(?::|[hH,.-]\s*)(\d{2})(?:(?::|[mM,.-]\s*)(\d{2})s?)?$/.exec(dateMatch[4].trim());
    if (!timeMatch) return { error: 'Heure invalide. Utilise HH:MM, HH:MM:SS ou HHh MMm SSs.' };
    const formats = preferences.dateFormats || ['DMY'];
    for (const format of formats) {
      const yearValue = format === 'YMD' ? dateMatch[1] : dateMatch[3];
      const year = Number(yearValue.length === 2 ? `20${yearValue}` : yearValue);
      const month = Number(format === 'MDY' ? dateMatch[1] : dateMatch[2]);
      const day = Number(format === 'MDY' ? dateMatch[2] : format === 'YMD' ? dateMatch[3] : dateMatch[1]);
      const candidate = DateTime.fromObject({ year, month, day, hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), second: Number(timeMatch[3] || 0) }, { zone: zoneInfo.zone });
      if (candidate.isValid) {
        dateTime = candidate;
        break;
      }
    }
  }
  if (!dateTime || !dateTime.isValid || dateTime.invalidReason === 'unparsable') return { error: 'Date invalide ou heure invalide. Vérifie le format configuré.' };
  return { dateTime, zoneInfo };
}

function formatLocal(dateTime) {
  return dateTime.toFormat("dd/MM/yyyy HH:mm 'UTC'ZZ");
}

function getEquivalentZones(dateTime, zoneInfo) {
  const offset = dateTime.offset;
  const names = new Set();
  names.add(`UTC${formatOffset(offset)}`);
  names.add(`GMT${formatOffset(offset)}`);
  for (const alias of FIXED_ALIASES.keys()) {
    const aliasInfo = resolveZone(alias);
    if (DateTime.fromMillis(dateTime.toMillis(), { zone: aliasInfo.zone }).offset === offset) names.add(alias);
  }
  for (const zone of Intl.supportedValuesOf('timeZone')) {
    if (zone === zoneInfo.canonical) continue;
    if (DateTime.fromMillis(dateTime.toMillis(), { zone }).offset === offset) names.add(zone);
  }
  return [...names].sort();
}

function representativeCountries(offset) {
  const countries = {
    0: ['Royaume-Uni', 'Islande', 'Ghana'],
    60: ['France', 'Allemagne', 'Italie'],
    120: ['Finlande', 'Roumanie', 'Afrique du Sud'],
    180: ['Turquie', 'Arabie saoudite', 'Kenya'],
    '-300': ['États-Unis', 'Canada', 'Colombie']
  };
  return countries[offset] || ['Pays avec le même offset', 'Pays avec le même offset', 'Pays avec le même offset'];
}

function discordTimestampFormats(seconds) {
  return {
    d: `<t:${seconds}:d>`,
    D: `<t:${seconds}:D>`,
    t: `<t:${seconds}:t>`,
    T: `<t:${seconds}:T>`,
    f: `<t:${seconds}:f>`,
    F: `<t:${seconds}:F>`,
    R: `<t:${seconds}:R>`
  };
}

function arrivalModesForDate(dateTime) {
  const paris = dateTime.setZone('Europe/Paris');
  const offsets = [-1, 0, 1].map(days => paris.plus({ days }).offset);
  const modes = new Set(offsets.map(offset => offset === 120 ? 'GMT' : 'UTC'));
  return [...modes];
}

module.exports = { arrivalModesForDate, dateInputExample, discordTimestampFormats, formatLocal, formatOffset, getEquivalentZones, parseDateTime, representativeCountries, resolveZone, timeInputExample };
