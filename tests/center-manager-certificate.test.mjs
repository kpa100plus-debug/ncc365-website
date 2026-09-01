import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminHtml = await readFile(new URL("../admin-center-manager-certificates.html", import.meta.url), "utf8");
const adminJs = await readFile(new URL("../js/admin-center-manager-certificates.js", import.meta.url), "utf8");
const printHtml = await readFile(new URL("../center-manager-certificate-print.html", import.meta.url), "utf8");
const printJs = await readFile(new URL("../js/center-manager-certificate-print.js", import.meta.url), "utf8");
const printCss = await readFile(new URL("../css/center-manager-certificate.css", import.meta.url), "utf8");
const verifyJs = await readFile(new URL("../js/certificate-verify.js", import.meta.url), "utf8");

test("center manager appointment studio supports member selection and direct issuance data", () => {
  for (const name of ["recipientName", "role", "region", "centerCode", "issuedAt", "validUntil", "certificateNumber"]) {
    assert.match(adminHtml, new RegExp(`name="${name}"`));
  }
  assert.match(adminHtml, /센터장 회원 선택/);
  assert.match(adminJs, /memberType === "center_manager"/);
  assert.match(adminJs, /plusOneYear/);
  assert.match(adminJs, /NCC-APT-/);
});

test("issuance stays inside the existing certificate and audit-log rule shape", () => {
  assert.match(adminJs, /certificateType: CERTIFICATE_TYPE/);
  assert.match(adminJs, /selectionNumber: draft\.centerCode/);
  assert.match(adminJs, /evaluationGroup:/);
  assert.match(adminJs, /collection\(db, "certificates"\)/);
  assert.match(adminJs, /collection\(db, "certificateLogs"\)/);
  assert.match(adminJs, /status: "active"/);
  assert.match(adminJs, /status: "revoked"/);
  assert.doesNotMatch(adminJs, /collection\(db, "appointmentCertificates"\)/);
});

test("A4 appointment template preserves the final approved essentials", () => {
  assert.match(printHtml, /센터장 임명장/);
  assert.match(printHtml, /LETTER OF APPOINTMENT/);
  assert.match(printHtml, /공식 센터확인/);
  assert.match(printHtml, /images\/NCC_OFFICIAL\.png/);
  assert.match(printCss, /REF-NCC-CERTIFICATE-VISUAL-QA-20260901-01/);
  assert.match(printCss, /@page\{size:A4 portrait/);
  assert.match(printCss, /certificate-watermark/);
  assert.doesNotMatch(printHtml, /빈 프레임/);
});

test("QR is generated as local SVG and points to the official certificate verification route", () => {
  assert.match(printHtml, /js\/vendor\/qrcode\.js/);
  assert.match(printJs, /window\.qrcode/);
  assert.match(printJs, /certificate-verify\.html\?id=/);
  assert.match(printJs, /createSvgTag/);
  assert.doesNotMatch(printJs, /api\.qrserver\.com|chart\.googleapis\.com/);
});

test("public verification identifies appointment records and cancellation status", () => {
  assert.match(verifyJs, /center_appointment: "센터장 임명장"/);
  assert.match(verifyJs, /revoked: \["발급 취소", false\]/);
  assert.match(verifyJs, /active: \["정상 발급", true\]/);
});
