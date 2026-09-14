/**
 * CALL-E supported calling regions.
 *
 * From the platform guidance: "A valid E.164 number does not establish that its
 * destination is supported." Checking format alone is not enough, and a request
 * to an uncovered destination fails with `unsupported_region` after the credit
 * has already been committed.
 *
 * So the rota resolves a destination before dialling, sets the recipient's
 * `region` and `locale` from this table, and warns when a number sits outside
 * coverage. Snapshot taken from the published regions table dated 2026-09-09.
 *
 * `line` records whether CALL-E dials from a local number or an international
 * one. International lines are documented as primarily for testing, which is
 * worth surfacing before someone relies on one for a production rota.
 */

export const SUPPORTED_REGIONS = [
  { code: 'US', calling: '1', name: 'United States', locale: 'en-US', line: 'local' },
  { code: 'CA', calling: '1', name: 'Canada', locale: 'en-CA', line: 'international' },
  { code: 'SG', calling: '65', name: 'Singapore', locale: 'en-SG', line: 'local' },
  { code: 'MY', calling: '60', name: 'Malaysia', locale: 'en-MY', line: 'local' },
  { code: 'IN', calling: '91', name: 'India', locale: 'en-IN', line: 'international' },
  { code: 'AE', calling: '971', name: 'United Arab Emirates', locale: 'en-AE', line: 'local' },
  { code: 'AU', calling: '61', name: 'Australia', locale: 'en-AU', line: 'local' },
  { code: 'GB', calling: '44', name: 'United Kingdom', locale: 'en-GB', line: 'international' },
  { code: 'VN', calling: '84', name: 'Viet Nam', locale: 'vi-VN', line: 'international' },
  { code: 'DE', calling: '49', name: 'Germany', locale: 'en-DE', line: 'international' },
  { code: 'JP', calling: '81', name: 'Japan', locale: 'ja-JP', line: 'international' },
  { code: 'FR', calling: '33', name: 'France', locale: 'fr-FR', line: 'international' },
  { code: 'MX', calling: '52', name: 'Mexico', locale: 'es-MX', line: 'local' },
  { code: 'BR', calling: '55', name: 'Brazil', locale: 'pt-BR', line: 'local' },
  { code: 'ID', calling: '62', name: 'Indonesia', locale: 'en-ID', line: 'international' },
  { code: 'PH', calling: '63', name: 'Philippines', locale: 'en-PH', line: 'international' },
  { code: 'KE', calling: '254', name: 'Kenya', locale: 'en-KE', line: 'international' },
  { code: 'NL', calling: '31', name: 'Netherlands', locale: 'en-NL', line: 'international' },
  { code: 'PL', calling: '48', name: 'Poland', locale: 'pl-PL', line: 'international' },
  { code: 'BD', calling: '880', name: 'Bangladesh', locale: 'bn-BD', line: 'international' },
  { code: 'NG', calling: '234', name: 'Nigeria', locale: 'en-NG', line: 'international' },
  { code: 'OM', calling: '968', name: 'Oman', locale: 'en-OM', line: 'international' },
  { code: 'TH', calling: '66', name: 'Thailand', locale: 'th-TH', line: 'international' },
  { code: 'NA', calling: '264', name: 'Namibia', locale: 'en-NA', line: 'international' },
  { code: 'CM', calling: '237', name: 'Cameroon', locale: 'en-CM', line: 'international' },
  { code: 'MZ', calling: '258', name: 'Mozambique', locale: 'en-MZ', line: 'international' },
  { code: 'SA', calling: '966', name: 'Saudi Arabia', locale: 'en-SA', line: 'international' },
  { code: 'FI', calling: '358', name: 'Finland', locale: 'en-FI', line: 'international' },
  { code: 'UA', calling: '380', name: 'Ukraine', locale: 'uk-UA', line: 'international' },
  { code: 'LK', calling: '94', name: 'Sri Lanka', locale: 'en-LK', line: 'international' },
  { code: 'BW', calling: '267', name: 'Botswana', locale: 'en-BW', line: 'international' },
  { code: 'PK', calling: '92', name: 'Pakistan', locale: 'en-PK', line: 'international' },
  { code: 'TR', calling: '90', name: 'Turkey', locale: 'tr-TR', line: 'international' },
  { code: 'HN', calling: '504', name: 'Honduras', locale: 'es-HN', line: 'international' },
  { code: 'ES', calling: '34', name: 'Spain', locale: 'es-ES', line: 'international' },
  { code: 'TW', calling: '886', name: 'Taiwan', locale: 'en-TW', line: 'international' },
  { code: 'ZA', calling: '27', name: 'South Africa', locale: 'en-ZA', line: 'international' },
  { code: 'EG', calling: '20', name: 'Egypt', locale: 'en-EG', line: 'international' },
  { code: 'GH', calling: '233', name: 'Ghana', locale: 'en-GH', line: 'international' },
  { code: 'IL', calling: '972', name: 'Israel', locale: 'en-IL', line: 'international' },
  { code: 'IE', calling: '353', name: 'Ireland', locale: 'en-IE', line: 'international' },
  { code: 'TN', calling: '216', name: 'Tunisia', locale: 'en-TN', line: 'international' }
];

/**
 * North American numbering plan area codes that belong to Canada rather than
 * the United States. Both share calling code +1, and the two are listed with
 * different line types, so the distinction is worth getting right.
 */
const CANADIAN_AREA_CODES = new Set([
  '204', '226', '236', '249', '250', '263', '289', '306', '343', '354', '365', '367', '368', '382',
  '387', '403', '416', '418', '428', '431', '437', '438', '450', '468', '474', '506', '514', '519',
  '548', '579', '581', '584', '587', '600', '604', '613', '622', '639', '647', '672', '683', '705',
  '709', '742', '753', '778', '780', '782', '807', '819', '825', '867', '873', '879', '902', '905'
]);

// Longest calling code first, so +1 never shadows +1... style prefixes and
// three-digit codes such as +971 resolve before +97 style partial matches.
const BY_LENGTH = [...SUPPORTED_REGIONS].sort((a, b) => b.calling.length - a.calling.length);

/**
 * Resolves an E.164 number to a CALL-E calling region.
 *
 * @param {string} e164 A number already normalised to +<digits>.
 * @returns {{supported: boolean, region: object|null, warning: string|null}}
 */
export function resolveRegion(e164) {
  if (typeof e164 !== 'string' || !e164.startsWith('+')) {
    return { supported: false, region: null, warning: 'Number is not in international format.' };
  }

  const digits = e164.slice(1);

  for (const region of BY_LENGTH) {
    if (!digits.startsWith(region.calling)) continue;

    let resolved = region;
    if (region.calling === '1') {
      const areaCode = digits.slice(1, 4);
      const isCanadian = CANADIAN_AREA_CODES.has(areaCode);
      resolved = SUPPORTED_REGIONS.find((r) => r.code === (isCanadian ? 'CA' : 'US'));
    }

    return {
      supported: true,
      region: resolved,
      warning: resolved.line === 'international'
        ? `CALL-E dials ${resolved.name} from an international line, which the platform documents as primarily for testing. Ask CALL-E to enable a local line before relying on this for a production rota.`
        : null
    };
  }

  return {
    supported: false,
    region: null,
    warning: `The country code in ${e164} is not in CALL-E's published coverage list. The call would be rejected with unsupported_region.`
  };
}

/** Country codes offered as quick-fill buttons in the rota dialog. */
export const QUICK_DIAL_CODES = ['+91', '+1', '+44', '+65'];
