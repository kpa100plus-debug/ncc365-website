import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);
const $ = selector => document.querySelector(selector);
const form = $("#verifyForm");
const input = $("#certificateNumber");
const message = $("#verifyMessage");
const result = $("#verifyResult");
const memberPattern = /^NCC-C-\d{6}$/;
const certificatePattern = /^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/;
const certificateStatus = { active: ["정상 활동", true], revoked: ["일시정지", false], expired: ["탈퇴 또는 만료", false], sample: ["미발급", false] };

function normalizeNumber(value) { return String(value || "").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, ""); }
function maskPublicName(value) { const chars = [...String(value || "").trim()]; if (!chars.length) return "기록 없음"; if (chars.length === 1) return chars[0] + "○"; if (chars.length === 2) return chars[0] + "○"; return chars[0] + "○".repeat(Math.min(3, chars.length - 2)) + chars.at(-1); }
function formatDate(value) {
  if (!value) return "기록 없음";
  const date = value?.toDate?.() || new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("ko-KR");
}
function setResult(data) {
  result.className = `verify-result status-${data.valid ? "active" : "revoked"}`;
  $("#statusIcon").textContent = data.valid ? "✓" : "!";
  $("#statusLabel").textContent = data.status;
  $("#statusDescription").textContent = `${data.type} 조회 결과입니다.`;
  $("#resultType").textContent = data.type;
  $("#resultNumber").textContent = data.number;
  $("#resultName").textContent = data.name || "기록 없음";
  $("#resultStatus").textContent = data.status;
  $("#resultDate").textContent = formatDate(data.date);
  $("#resultValidity").textContent = data.valid ? "유효" : "유효하지 않음";
  $("#resultIssuer").textContent = "전국소비자클럽(NCC)";
  const link = $("#certificateImageLink");
  link.hidden = !data.imageUrl;
  if (data.imageUrl) link.href = data.imageUrl; else link.removeAttribute("href");
  result.hidden = false;
}
async function lookupMember(number) {
  const response = await fetch(`/api/account/verify?id=${encodeURIComponent(number)}`, { headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(body.message || "회원 조회 오류");
  const record = body.verification || {};
  return { type: record.type, number: record.number, name: record.name, status: record.status, date: record.joinedAt, valid: record.valid === true };
}
async function lookupCertificate(number) {
  const snapshot = await getDoc(doc(db, "certificates", number));
  if (!snapshot.exists() || snapshot.data().public !== true) return null;
  const data = snapshot.data();
  const meta = certificateStatus[data.status] || certificateStatus.revoked;
  return { type: "NCC 발급 인증서", number, name: maskPublicName(data.recipientName), status: meta[0], date: data.issuedAt, valid: meta[1], imageUrl: data.imageUrl };
}
async function verify(rawValue, updateUrl = true) {
  const number = normalizeNumber(rawValue);
  input.value = number;
  result.hidden = true;
  message.className = "verify-message";
  const isMember = memberPattern.test(number);
  const isCertificate = !isMember && certificatePattern.test(number);
  if (!isMember && !isCertificate) {
    message.textContent = "번호 형식을 확인해 주세요. 예: NCC-C-000011 또는 NCC-EC-2026-FD-0001";
    message.classList.add("error");
    return;
  }
  if (updateUrl) { const url = new URL(location.href); url.searchParams.set("id", number); history.replaceState(null, "", url); }
  message.textContent = "공식 기록을 확인하고 있습니다.";
  try {
    const data = isMember ? await lookupMember(number) : await lookupCertificate(number);
    if (!data) { message.textContent = "존재하지 않는 번호입니다."; message.classList.add("error"); return; }
    message.textContent = "공식 기록을 확인했습니다.";
    message.classList.add("success");
    setResult(data);
  } catch (error) {
    console.error(error);
    message.textContent = "조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    message.classList.add("error");
  }
}
form.addEventListener("submit", event => { event.preventDefault(); verify(input.value); });
const initialId = new URLSearchParams(location.search).get("id");
if (initialId) verify(initialId, false);
