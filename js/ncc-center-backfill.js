/* Existing-member center-code backfill safeguards.
 * REF-NCC-CENTER-LEGACY-BACKFILL-20260831-01
 */

const TEMPORARY_CENTER_VALUES = new Set([
  '', '-', '잘모름', '미정', '없음', '미확정', '미지정', 'na', 'n/a', 'none', 'unknown'
]);

function normalizedValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(' ', '');
}

export function isOfficialCenterCode(value) {
  return /^NCC-[PML]-\d{10}$/.test(String(value ?? '').trim());
}

export function isTemporaryCenterValue(value) {
  return TEMPORARY_CENTER_VALUES.has(normalizedValue(value));
}

export function shouldBackfillCenterCode(member) {
  return isTemporaryCenterValue(member?.centerCode);
}

export function hasUsableCenterAddress(member) {
  return String(member?.region ?? '').trim().length >= 4;
}

export function buildCenterBackfillPatch(member, assignment) {
  if (
    !shouldBackfillCenterCode(member) ||
    assignment?.status !== 'assigned' ||
    !isOfficialCenterCode(assignment.centerCode)
  ) {
    return null;
  }

  const patch = {
    centerCode: assignment.centerCode,
    centerAssignmentStatus: 'assigned',
    centerAssignmentReason: '',
    centerOfficialAdminCode: assignment.officialAdminCode || '',
    centerLevel: assignment.level || ''
  };

  if (isTemporaryCenterValue(member?.centerName)) {
    patch.centerName = assignment.centerName;
  }

  return patch;
}
