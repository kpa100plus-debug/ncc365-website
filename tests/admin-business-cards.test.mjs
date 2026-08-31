import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../admin-business-cards.html", import.meta.url), "utf8");
const js = await readFile(new URL("../js/admin-business-cards.js", import.meta.url), "utf8");
const css = await readFile(new URL("../css/admin-business-cards.css", import.meta.url), "utf8");

test("business card studio contains required operational fields", () => {
  for (const name of ["name", "role", "centerName", "centerCode", "memberNumber", "phone", "email", "address", "orientation"]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
});

test("business card studio verifies the live member and center role before export", () => {
  assert.match(js, /NCC-C-\[0-9\]\{6\}/);
  assert.match(js, /where\("memberNumber", "==", memberNumber\)/);
  assert.match(js, /CENTER_ROLES/);
  assert.match(html, /id="loadMemberButton"/);
  assert.match(js, /certificate-verify\.html\?id=/);
  assert.doesNotMatch(js, /NCC-CM-/);
});

test("business card studio distinguishes member login from administrator access", () => {
  assert.match(html, /id="adminNavigation" hidden/);
  assert.match(html, /관리자 로그아웃/);
  assert.match(js, /현재 회원 계정으로 로그인되어 있습니다/);
  assert.match(js, /센터 명함 자동제작은 관리자 전용 화면입니다/);
  assert.match(js, /navigation\.hidden = true/);
  assert.match(js, /navigation\.hidden = false/);
});

test("business card studio supports exact artwork, trim and portrait specifications", () => {
  assert.match(html, /가로형 92×52mm 작업 \/ 90×50mm 재단/);
  assert.match(html, /300dpi · 가로 1087×614px/);
  assert.match(css, /aspect-ratio:92\/52/);
  assert.match(html, /class="trim-guide"/);
  assert.match(html, /class="safe-guide"/);
});

test("front and back export as exact 300dpi JPEG files", () => {
  assert.match(html, /data-export="front"/);
  assert.match(html, /data-export="back"/);
  assert.match(js, /width: 1087, height: 614/);
  assert.match(js, /bytes\[index \+ 12\] = 0x01/);
  assert.match(js, /bytes\[index \+ 13\] = 0x2c/);
});

test("print checklist is honest about browser JPG and CMYK preflight", () => {
  assert.match(html, /인쇄 규격 자동검사/);
  assert.match(html, /300dpi RGB 인쇄 참고본/);
  assert.match(html, /전체 CMYK 변환/);
  assert.match(html, /오버프린트 금지/);
  assert.doesNotMatch(html, /CMYK 파일 다운로드/);
});

test("center code and member number both drive verified member lookup", () => {
  assert.match(js, /lookupMode = "centerCode"/);
  assert.match(js, /where\("centerCode", "==", centerCode\)/);
  assert.match(js, /verifiedCenterCode === data\.centerCode/);
  assert.match(js, /명함 대상 회원이 여러 명/);
});

test("studio does not ship misleading sample member data", () => {
  assert.doesNotMatch(html, /value="김민준"/);
  assert.doesNotMatch(html, /value="010-1234-5678"/);
  assert.match(css, /REF-NCC-BUSINESS-CARD-DATA-LOOKUP-FIX-20260830/);
});

test("center card uses the approved landscape-only green and gold design", () => {
  assert.match(html, /type="hidden" name="orientation" value="landscape"/);
  assert.doesNotMatch(html, /value="portrait"/);
  assert.match(html, /ACTIVE CENTER/);
  assert.match(html, /class="gold-chip"/);
  assert.match(html, /class="member-panel"/);
  assert.match(css, /REF-NCC-CENTER-CARD-LANDSCAPE-REDESIGN-20260830/);
  assert.doesNotMatch(js, /width: 614, height: 1087/);
});

test("center card back uses an icon-led NCC benefit showcase without personal details", () => {
  assert.match(html, /소비자에게 더 많은 혜택을/);
  assert.match(html, /CONSUMER BENEFITS · BUSINESS SUPPORT · SHARING ECONOMY/);
  assert.match(html, /소비자·지역·기업을 연결하는 NCC 365/);
  assert.match(html, /class="benefit-showcase"/);
  assert.match(html, /class="benefit-icon-list"/);
  assert.match(html, /무료 경험/);
  assert.match(html, /회원 할인/);
  assert.match(html, /공동구매/);
  assert.match(html, /지역 혜택/);
  assert.match(html, /소비자를 중심으로 더 큰 가치를 연결합니다/);
  assert.match(html, /class="secure-message"/);
  assert.doesNotMatch(html, /class="card-promotion"/);
  assert.doesNotMatch(html, /class="back-logo"/);
  assert.doesNotMatch(html, /class="signature-area"/);
  assert.doesNotMatch(html, /AUTHORIZED CENTER/);
  assert.match(css, /REF-NCC-CARD-BACK-BENEFIT-SHOWCASE-20260831-01/);
  assert.match(css, /REF-NCC-CARD-BACK-PRINT-SCALE-20260831-01/);
  assert.match(css, /REF-NCC-CARD-BACK-EMERALD-BAND-20260831-01/);
  assert.match(css, /REF-NCC-CARD-FRONT-CONTACT-PRINT-SCALE-20260831-01/);
});
