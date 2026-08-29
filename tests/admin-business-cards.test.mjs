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
test("business card studio supports 90 by 50 landscape and portrait previews",()=>{
  assert.match(html,/가로형 90×50mm/);assert.match(html,/세로형 50×90mm/);assert.match(css,/aspect-ratio:1\.8\/1/);assert.match(css,/aspect-ratio:1\/1\.8/);
});
test("preview does not claim to be a print-ready CMYK artifact",()=>{
  assert.match(html,/화면 미리보기만 제공/);assert.doesNotMatch(html,/다운로드/);
});
