import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const js=readFileSync("js/benefit-detail.js","utf8");
const html=readFileSync("benefit-detail.html","utf8");
const wallet=readFileSync("js/wallet.js","utf8");

test("benefit application matches the strict Firestore field allowlist",()=>{
  assert.doesNotMatch(js,/offerTier/);
  assert.match(js,/offerTitle:offer\.title,receipt,status:"new",source:"website"/);
});

test("participation and recruitment alert have separate success feedback",()=>{
  assert.match(js,/모집 알림 신청이 완료되었습니다/);
  assert.match(js,/NCC 알림함과 가입 이메일/);
  assert.match(html,/id="successTitle"/);
});

test("wallet login reports wrong password and unknown email errors",()=>{
  assert.match(wallet,/비밀번호가 올바르지 않습니다/);
  assert.match(wallet,/등록되지 않은 이메일입니다/);
});
