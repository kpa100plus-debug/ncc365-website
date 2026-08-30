/* NCC address-based center assignment.
 * REF-NCC-CENTER-AUTO-ASSIGN-20260830-01
 */

function compact(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s,().-]/g, '')
    .trim();
}

function text(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function scoreAddress(address, record) {
  const normalizedAddress = compact(address);
  const province = text(record, ['provinceName', 'sido', 'province']);
  const municipality = text(record, ['municipalityName', 'sigungu', 'district']);
  const local = text(record, ['localName', 'eupMyeonDong', 'dong']);
  const full = text(record, ['fullName', 'centerArea', 'addressArea']);

  if (full && normalizedAddress.includes(compact(full))) return 400 + compact(full).length;
  if (local && municipality && normalizedAddress.includes(compact(municipality + local))) return 300 + compact(local).length;
  if (local && normalizedAddress.includes(compact(local))) return 200 + compact(local).length;
  if (municipality && normalizedAddress.includes(compact(municipality))) return 100 + compact(municipality).length;
  if (province && normalizedAddress.includes(compact(province))) return 50 + compact(province).length;
  return 0;
}

function normalizeCenter(record) {
  const centerCode = text(record, ['centerCode', 'code']);
  const centerName = text(record, ['centerName', 'name']);
  if (!centerCode || !centerName) return null;
  return {
    centerCode,
    centerName,
    officialAdminCode: text(record, ['officialAdminCode', 'adminCode']),
    level: text(record, ['level']),
    status: text(record, ['status']) || 'reserved'
  };
}

export async function resolveCenterAssignment(db, address, firestore) {
  const normalizedAddress = compact(address);
  if (normalizedAddress.length < 4) {
    return { status: 'pending', reason: 'ADDRESS_TOO_SHORT', centerCode: '', centerName: '' };
  }

  try {
    const snapshot = await firestore.getDocs(firestore.collection(db, 'centerDirectory'));
    const candidates = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !['inactive', 'closed'].includes(String(item.status ?? '').toLowerCase()))
      .map((item) => ({ item, score: scoreAddress(address, item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      return { status: 'pending', reason: 'NO_MATCH', centerCode: '', centerName: '' };
    }

    const top = candidates[0];
    const second = candidates[1];
    if (second && second.score === top.score) {
      return { status: 'pending', reason: 'AMBIGUOUS', centerCode: '', centerName: '' };
    }

    const center = normalizeCenter(top.item);
    if (!center) {
      return { status: 'pending', reason: 'INVALID_DIRECTORY_RECORD', centerCode: '', centerName: '' };
    }

    return { status: 'assigned', reason: '', ...center };
  } catch (error) {
    console.warn('센터 자동배정 조회 실패', error);
    return { status: 'pending', reason: 'DIRECTORY_UNAVAILABLE', centerCode: '', centerName: '' };
  }
}
