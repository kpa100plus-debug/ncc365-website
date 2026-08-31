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

// Older imported member data sometimes omits legal-area suffixes, for example
// "서울 강남 삼성동" or "전북 전주".  These aliases are used only for
// matching; the original member address is never rewritten.
function administrativeAliases(value, level) {
  const normalized = compact(value);
  const aliases = new Set(normalized ? [normalized] : []);

  if (level === 'province') {
    const abbreviated = normalized.replace(/특별자치도$|특별시$|광역시$|자치시$|도$/, '');
    if (abbreviated.length >= 2) aliases.add(abbreviated);
  }

  if (level === 'municipality') {
    const abbreviated = normalized.replace(/(시|군|구)$/, '');
    if (abbreviated.length >= 2) aliases.add(abbreviated);
  }

  return [...aliases];
}

function includesAdministrativeName(address, normalizedAddress, value, level) {
  const fullName = compact(value);
  if (fullName && normalizedAddress.includes(fullName)) return true;

  // Short forms must be a complete address token. This prevents a district
  // such as "성동" from incorrectly matching the final two characters of
  // "삼성동" in a legacy spaced address.
  const tokens = String(address ?? '')
    .normalize('NFKC')
    .split(/[\s,().-]+/)
    .map((item) => compact(item))
    .filter(Boolean);
  return administrativeAliases(value, level).some((alias) => tokens.includes(alias));
}

function scoreAddress(address, record) {
  const normalizedAddress = compact(address);
  const province = text(record, ['provinceName', 'sido', 'province']);
  const municipality = text(record, ['municipalityName', 'sigungu', 'district']);
  const local = text(record, ['localName', 'eupMyeonDong', 'dong']);
  const full = text(record, ['fullName', 'centerArea', 'addressArea']);
  const level = text(record, ['level']);
  const levelBonus = level === 'local' ? 30 : level === 'municipality' ? 20 : 10;
  const municipalityMatches = municipality && includesAdministrativeName(address, normalizedAddress, municipality, 'municipality');
  const localMatches = local && normalizedAddress.includes(compact(local));

  if (full && normalizedAddress.includes(compact(full))) return 400 + levelBonus + compact(full).length;
  if (level === 'local' && localMatches && municipalityMatches) return 300 + compact(local).length;
  // A local name alone is deliberately lower than a matched city/county.
  // Identical names exist in multiple regions, so this avoids guessing a
  // local center from a legacy address that states a different municipality.
  if (level === 'local' && localMatches) return 80 + compact(local).length;
  if (level === 'municipality' && municipality && municipalityMatches) {
    return 100 + Math.max(...administrativeAliases(municipality, 'municipality').map((item) => item.length));
  }
  if (level === 'province' && province && includesAdministrativeName(address, normalizedAddress, province, 'province')) {
    return 50 + Math.max(...administrativeAliases(province, 'province').map((item) => item.length));
  }
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

let staticDirectoryPromise;
let mergedDirectoryPromise;

async function loadStaticDirectory() {
  if (!staticDirectoryPromise) {
    staticDirectoryPromise = fetch('./data/ncc-center-directory-20260701.json.gz', {
      cache: 'force-cache'
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('CENTER_DIRECTORY_HTTP_' + response.status);
        if (typeof DecompressionStream !== 'function') {
          throw new Error('CENTER_DIRECTORY_GZIP_UNSUPPORTED');
        }
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text());
      })
      .then((payload) => Array.isArray(payload?.centers) ? payload.centers : []);
  }
  return staticDirectoryPromise;
}

async function loadCenterDirectory(db, firestore) {
  if (!mergedDirectoryPromise) {
    mergedDirectoryPromise = (async () => {
      const staticRecords = await loadStaticDirectory();

      try {
        const snapshot = await firestore.getDocs(firestore.collection(db, 'centerDirectory'));
        const liveRecords = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (!liveRecords.length) return staticRecords;

        const merged = new Map(staticRecords.map((item) => [item.centerCode, item]));
        liveRecords.forEach((item) => merged.set(item.centerCode || item.code || item.id, item));
        return Array.from(merged.values());
      } catch (directoryError) {
        console.info('Firestore 센터목록 대신 공식 정적목록을 사용합니다.', directoryError);
        return staticRecords;
      }
    })();
  }

  try {
    return await mergedDirectoryPromise;
  } catch (error) {
    mergedDirectoryPromise = undefined;
    throw error;
  }
}

export function selectBestCenter(address, records) {
  const candidates = records
    .filter((item) => !['inactive', 'closed'].includes(String(item.status ?? '').toLowerCase()))
    .map((item) => ({ item, score: scoreAddress(address, item) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return { status: 'pending', reason: 'NO_MATCH', centerCode: '', centerName: '' };
  }

  const top = candidates[0];
  const tied = candidates.filter(({ score }) => score === top.score);
  const distinctCodes = new Set(tied.map(({ item }) => text(item, ['centerCode', 'code'])));
  if (distinctCodes.size > 1) {
    return { status: 'pending', reason: 'AMBIGUOUS', centerCode: '', centerName: '' };
  }

  const center = normalizeCenter(top.item);
  if (!center) {
    return { status: 'pending', reason: 'INVALID_DIRECTORY_RECORD', centerCode: '', centerName: '' };
  }

  return { ...center, status: 'assigned', directoryStatus: center.status, reason: '' };
}

export async function resolveCenterAssignment(db, address, firestore) {
  const normalizedAddress = compact(address);
  if (normalizedAddress.length < 4) {
    return { status: 'pending', reason: 'ADDRESS_TOO_SHORT', centerCode: '', centerName: '' };
  }

  try {
    const records = await loadCenterDirectory(db, firestore);
    return selectBestCenter(address, records);
  } catch (error) {
    console.warn('센터 자동배정 조회 실패', error);
    return { status: 'pending', reason: 'DIRECTORY_UNAVAILABLE', centerCode: '', centerName: '' };
  }
}
