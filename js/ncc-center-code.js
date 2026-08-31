/* NCC nationwide center-code utilities.
 * Standard: REF-NCC-CENTER-CODE-NATIONAL-20260830-01
 */

const LEVEL_PREFIX = Object.freeze({
  headquarters: 'HQ',
  province: 'P',
  municipality: 'M',
  local: 'L'
});

export const NCC_CENTER_CODE_PATTERN = /^NCC-(HQ|P|M|L)-\d{10}$/;

export function normalizeOfficialAdminCode(value) {
  const code = String(value ?? '').trim();
  if (!/^\d{10}$/.test(code)) {
    throw new TypeError('공식 행정코드는 숫자 10자리여야 합니다.');
  }
  return code;
}

export function createNccCenterCode(level, officialAdminCode) {
  const prefix = LEVEL_PREFIX[level];
  if (!prefix) {
    throw new TypeError('센터 단계는 headquarters, province, municipality, local 중 하나여야 합니다.');
  }

  const code = normalizeOfficialAdminCode(officialAdminCode);
  if (level === 'headquarters' && code !== '0000000000') {
    throw new TypeError('본사 공식 코드는 0000000000만 사용할 수 있습니다.');
  }
  if (level !== 'headquarters' && code === '0000000000') {
    throw new TypeError('지역 센터에는 0000000000을 사용할 수 없습니다.');
  }

  return `NCC-${prefix}-${code}`;
}

export function isValidNccCenterCode(value) {
  return NCC_CENTER_CODE_PATTERN.test(String(value ?? '').trim());
}

export function parseNccCenterCode(value) {
  const normalized = String(value ?? '').trim();
  const match = normalized.match(NCC_CENTER_CODE_PATTERN);
  if (!match) {
    throw new TypeError('올바른 NCC 센터코드가 아닙니다.');
  }

  const prefix = match[1];
  const officialAdminCode = normalized.slice(-10);
  const level = Object.keys(LEVEL_PREFIX).find((key) => LEVEL_PREFIX[key] === prefix);
  return Object.freeze({ centerCode: normalized, level, officialAdminCode });
}

export function buildCenterRecord({ level, officialAdminCode, names, status = 'reserved' }) {
  if (!['reserved', 'active', 'inactive'].includes(status)) {
    throw new TypeError('센터 상태는 reserved, active, inactive 중 하나여야 합니다.');
  }
  const centerCode = createNccCenterCode(level, officialAdminCode);
  return Object.freeze({ centerCode, officialAdminCode: normalizeOfficialAdminCode(officialAdminCode), level, names, status });
}