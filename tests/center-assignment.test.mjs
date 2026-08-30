import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { selectBestCenter } from '../js/ncc-center-assignment.js';

const directory = JSON.parse(
  await readFile(new URL('../data/ncc-center-directory-20260701.json', import.meta.url), 'utf8')
);
const centers = directory.centers;

test('공식 센터목록은 3,923개이며 코드가 중복되지 않는다', () => {
  assert.equal(directory.meta.count, 3923);
  assert.equal(centers.length, 3923);
  assert.equal(centers.filter(({ level }) => level === 'province').length, 16);
  assert.equal(centers.filter(({ level }) => level === 'municipality').length, 280);
  assert.equal(centers.filter(({ level }) => level === 'local').length, 3627);
  assert.equal(new Set(centers.map(({ centerCode }) => centerCode)).size, centers.length);
});

test('행정동이 주소에 있으면 읍면동 센터를 자동배정한다', () => {
  const result = selectBestCenter('서울특별시 종로구 청운효자동 10', centers);
  assert.equal(result.status, 'assigned');
  assert.equal(result.centerCode, 'NCC-L-1111051500');
});

test('법정동 도로주소는 확인 가능한 시군구 센터로 안전하게 배정한다', () => {
  const result = selectBestCenter('서울특별시 강남구 삼성동 100', centers);
  assert.equal(result.status, 'assigned');
  assert.equal(result.centerCode, 'NCC-M-1168000000');
});

test('세종특별자치시는 시군구급 코드가 우선된다', () => {
  const result = selectBestCenter('세종특별자치시 한누리대로 2130', centers);
  assert.equal(result.status, 'assigned');
  assert.equal(result.centerCode, 'NCC-M-3611000000');
});

test('행정구역을 판별할 수 없는 주소는 임의 배정하지 않는다', () => {
  assert.deepEqual(selectBestCenter('주소 미상', centers), {
    status: 'pending',
    reason: 'NO_MATCH',
    centerCode: '',
    centerName: ''
  });
});
