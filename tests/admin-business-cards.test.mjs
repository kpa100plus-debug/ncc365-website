import test from"node:test";
import assert from"node:assert/strict";
import{readFile}from"node:fs/promises";

const html=await readFile(new URL("../admin-business-cards.html",import.meta.url),"utf8");
const js=await readFile(new URL("../js/admin-business-cards.js",import.meta.url),"utf8");
const css=await readFile(new URL("../css/admin-business-cards.css",import.meta.url),"utf8");

test("business card studio contains required operational fields",()=>{
  for(const name of["name","role","centerName","centerCode","memberNumber","phone","email","address","orientation"])assert.match(html,new RegExp(`name="${name}"`));
});
test("business card studio uses the live NCC member-number and verification URL rules",()=>{
  assert.match(js,/NCC-C-\[0-9\]\{6\}/);assert.match(js,/certificate-verify\.html\?id=/);assert.doesNotMatch(js,/NCC-CM-/);
});
test("business card studio supports artwork, trim and portrait specifications",()=>{
  assert.match(html,/가로형 92×52mm 작업 \/ 90×50mm 재단/);
  assert.match(html,/세로형 52×92mm 작업 \/ 50×90mm 재단/);
  assert.match(html,/300dpi · 가로 1087×614px \/ 세로 614×1087px/);
  assert.match(css,/aspect-ratio:1\.8\/1/);
  assert.match(css,/aspect-ratio:52\/92/);
  assert.match(html,/class="trim-guide"/);
  assert.match(html,/class="safe-guide"/);
});
test("preview exposes print safety checks without claiming a generated CMYK file",()=>{
  assert.match(html,/인쇄 규격 자동검사/);
  assert.match(html,/오버프린트 금지/);
  assert.doesNotMatch(html,/CMYK 파일 다운로드/);
});
