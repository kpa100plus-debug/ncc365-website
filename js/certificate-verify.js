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

const statusMeta = {
  active: {
    label: "정상 발급",
    description: "전국소비자클럽의 발급 기록과 일치하는 유효한 인증서입니다.",
    icon: "✓"
  },
  revoked: {
    label: "효력 정지",
    description: "발급 기록은 존재하지만 현재 효력이 정지된 인증서입니다.",
    icon: "!"
  },
  expired: {
    label: "유효기간 만료",
    description: "발급 기록은 존재하지만 표시된 유효기간이 종료되었습니다.",
    icon: "!"
  },
  sample: {
    label: "검토용 샘플",
    description: "디자인과 시스템 검토를 위한 샘플이며 정식 인증 효력은 없습니다.",
    icon: "S"
  }
};

function normalizeNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "");
}

function isValidNumber(value) {
  return /^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/.test(value) && value.length <= 50;
}

function formatDate(value) {
  if (!value) return "-";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : value;
  }
  if (value.toDate) return value.toDate().toLocaleDateString("ko-KR");
  return "-";
}

function setText(selector, value) {
  $(selector).textContent = value || "-";
}

function showResult(data) {
  const meta = statusMeta[data.status] || statusMeta.revoked;
  result.className = `verify-result status-${data.status || "revoked"}`;
  $("#statusIcon").textContent = meta.icon;
  $("#statusLabel").textContent = meta.label;
  $("#statusDescription").textContent = meta.description;
  setText("#resultNumber", data.certificateNumber);
  setText("#resultTitle", data.title);
  setText("#resultRecipient", data.recipientName);
  setText("#resultCategory", data.category);
  setText("#resultIssuedAt", formatDate(data.issuedAt));
  setText("#resultStatus", meta.label);
  setText("#resultRegion", data.region);
  setText("#resultIssuer", data.issuer || "전국소비자클럽 소비자선정위원회");

  const imageLink = $("#certificateImageLink");
  const imageUrl = String(data.imageUrl || "").trim();
  if (imageUrl && (/^https:\/\//i.test(imageUrl) || /^[./]/.test(imageUrl))) {
    imageLink.href = imageUrl;
    imageLink.hidden = false;
  } else {
    imageLink.hidden = true;
    imageLink.removeAttribute("href");
  }
  result.hidden = false;
}

async function verifyCertificate(rawValue, updateUrl = true) {
  const certificateNumber = normalizeNumber(rawValue);
  input.value = certificateNumber;
  result.hidden = true;
  message.className = "verify-message";

  if (!isValidNumber(certificateNumber)) {
    message.textContent = "인증번호 형식을 확인해 주세요. 예: NCC-EC-2026-FD-0001";
    message.classList.add("error");
    return;
  }

  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("id", certificateNumber);
    history.replaceState(null, "", url);
  }

  message.textContent = "공식 발급 기록을 확인하고 있습니다.";
  try {
    const snapshot = await getDoc(doc(db, "certificates", certificateNumber));
    if (!snapshot.exists()) {
      message.textContent = "일치하는 발급 기록이 없습니다. 번호를 다시 확인하거나 전국소비자클럽에 문의해 주세요.";
      message.classList.add("error");
      return;
    }
    const data = snapshot.data();
    if (data.public !== true) {
      message.textContent = "현재 공개 조회가 제한된 인증서입니다. 전국소비자클럽에 문의해 주세요.";
      message.classList.add("error");
      return;
    }
    message.textContent = "발급 기록을 확인했습니다.";
    message.classList.add("success");
    showResult(data);
  } catch (error) {
    console.error(error);
    message.textContent = error?.code === "permission-denied"
      ? "일치하는 공개 발급 기록이 없습니다. 번호를 다시 확인하거나 전국소비자클럽에 문의해 주세요."
      : "조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    message.classList.add("error");
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  verifyCertificate(input.value);
});

const initialId = new URLSearchParams(location.search).get("id");
if (initialId) verifyCertificate(initialId, false);
