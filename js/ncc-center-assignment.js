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
  const level = text(record, ['level']);
  const levelBonus = level === 'local' ? 30 : level === 'municipality' ? 20 : 10;

  if (full && normalizedAddress.includes(compact(full))) return 400 + levelBonus + compact(full).length;
  if (level === 'local' && local && municipality && normalizedAddress.includes(compact(municipality + local))) return 300 + compact(local).length;
  if (level === 'local' && local && normalizedAddress.includes(compact(local))) return 200 + compact(local).length;
  if (level === 'municipality' && municipality && normalizedAddress.includes(compact(municipality))) return 100 + compact(municipality).length;
  if (level === 'province' && province && normalizedAddress.includes(compact(province))) return 50 + compact(province).length;
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
