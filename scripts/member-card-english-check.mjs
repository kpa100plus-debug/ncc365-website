import assert from "node:assert/strict";
import {
  formatCardholderName,
  formatCardMemberType,
  formatCardRegion
} from "../js/member-card-english.js";

const nameCases = [
  [{ name: "오테스트" }, "OH TEST"],
  [{ name: "김민수" }, "KIM MIN-SOO"],
  [{ name: "이서연" }, "LEE SEO-YEON"],
  [{ name: "박준호" }, "PARK JOON-HO"],
  [{ name: "남궁민" }, "NAMGUNG MIN"],
  [{ name: "김민수", cardNameEn: "Min Soo Kim" }, "MIN SOO KIM"],
  [{ name: "JANE KIM" }, "JANE KIM"]
];

const regionCases = [
  [{ region: "경북 울진" }, "ULJIN · GYEONGBUK · KR"],
  [{ region: "경상북도 울진군 울진읍" }, "ULJIN · GYEONGBUK · KR"],
  [{ region: "서울특별시 강남구 삼성동" }, "GANGNAM · SEOUL · KR"],
  [{ region: "부산광역시 해운대구" }, "HAEUNDAE · BUSAN · KR"],
  [{ region: "광주광역시 북구" }, "BUK-GU · GWANGJU · KR"],
  [{ region: "울산광역시 남구" }, "NAM-GU · ULSAN · KR"],
  [{ region: "제주특별자치도 제주시" }, "JEJU · KR"],
  [{ region: "경북 울진", regionEn: "Uljin · Gyeongbuk · KR" }, "ULJIN · GYEONGBUK · KR"]
];

const coverageNames = [
  "최지우", "정현수", "강서윤", "조민준", "윤지호", "장하은", "임재현", "한유진",
  "황보민", "제갈성", "JENNIFER ALEXANDRA KIM"
];

const coverageRegions = [
  "서울특별시 종로구", "부산광역시 수영구", "대구광역시 달서구", "인천광역시 연수구",
  "광주광역시 북구", "대전광역시 유성구", "울산광역시 남구", "세종특별자치시",
  "경기도 수원시", "강원특별자치도 춘천시", "충청북도 청주시", "충청남도 천안시",
  "전북특별자치도 전주시", "전라남도 순천시", "경상남도 창원시", "제주특별자치도 서귀포시"
];

for (const [input, expected] of nameCases) {
  assert.equal(formatCardholderName(input), expected);
}

for (const [input, expected] of regionCases) {
  assert.equal(formatCardRegion(input), expected);
}

for (const value of [...nameCases.map(([input]) => formatCardholderName(input)), ...regionCases.map(([input]) => formatCardRegion(input))]) {
  assert.doesNotMatch(value, /[\uac00-\ud7a3]/, `Hangul remains in card value: ${value}`);
}

for (const name of coverageNames) {
  const value = formatCardholderName({ name });
  assert.ok(value && value.length <= 48, `Invalid card name: ${value}`);
  assert.doesNotMatch(value, /[\uac00-\ud7a3]/, `Hangul remains in card name: ${value}`);
}

for (const region of coverageRegions) {
  const value = formatCardRegion({ region });
  assert.ok(value.endsWith("KR") && value.length <= 64, `Invalid card region: ${value}`);
  assert.doesNotMatch(value, /[\uac00-\ud7a3]/, `Hangul remains in card region: ${value}`);
}

assert.equal(formatCardMemberType("consumer"), "CONSUMER MEMBER");
assert.equal(formatCardMemberType("unknown"), "NCC MEMBER");
console.log(`NCC member-card English check passed (${nameCases.length + regionCases.length + coverageNames.length + coverageRegions.length + 2} cases).`);
