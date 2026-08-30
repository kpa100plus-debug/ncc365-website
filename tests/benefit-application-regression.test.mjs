import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync("js/benefit-detail.js", "utf8");
const html = readFileSync("benefit-detail.html", "utf8");
const wallet = readFileSync("js/wallet.js", "utf8");
const activity = readFileSync("js/wallet-activity.js", "utf8");
const admin = readFileSync("js/admin-applications.js", "utf8");

test("benefit application matches the strict Firestore field allowlist", () => {
  assert.doesNotMatch(js, /offerTier/);
  for (const field of ["memberId", "memberEmail", "offerId", "offerTitle", "status", "source"]) {
    assert.match(js, new RegExp(`${field}:`));
  }
  assert.match(js, /\n\s+receipt,/);
});

test("application waits for auth and restores the wallet member before submission", () => {
  assert.match(html, /type="submit" disabled>회원정보 확인 중/);
  assert.match(js, /sessionStorage\.getItem\("nccMemberProfile"\)/);
  assert.match(js, /getDoc\(doc\(db, "members", saved\.id\)\)/);
  assert.match(js, /setFormReady\(true\)/);
});

test("participation and recruitment alert have separate, honest success feedback", () => {
  assert.match(js, /모집 알림 신청이 완료되었습니다/);
  assert.match(js, /관리자가 모집 시작을 승인하면 월렛 알림함에 안내가 표시됩니다/);
  assert.match(html, /id="successTitle"/);
  assert.doesNotMatch(js, /자동.*(?:이메일|문자)|(?:이메일|문자).*자동/);
});

test("admin status changes create an in-wallet notification visible in member activity", () => {
  assert.match(admin, /memberNotifications/);
  assert.match(admin, /모집 시작 안내/);
  assert.match(activity, /collection\(db, "memberNotifications"\)/);
  assert.match(activity, /data-activity="notification"/);
});

test("wallet login reports wrong password and unknown email errors", () => {
  assert.match(wallet, /비밀번호가 올바르지 않습니다/);
  assert.match(wallet, /등록되지 않은 이메일입니다/);
});

test("benefit id is explicitly shared with the submit module", () => {
  const content = readFileSync("js/benefit-detail-content.js", "utf8");
  assert.match(content, /export const offerId/);
  assert.match(js, /import \{ offer, offerId \}/);
  assert.match(js, /offerId,/);
  assert.doesNotMatch(js, /offerId: id/);
  assert.doesNotMatch(js, /saved\.offerId === id/);
});

test("submission immediately reports progress and catches preparation failures", () => {
  assert.match(js, /혜택 신청을 접수하고 있습니다/);
  assert.match(js, /try \{\s+const receipt/);
});
