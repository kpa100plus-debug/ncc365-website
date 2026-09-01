import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const $ = selector => document.querySelector(selector);
const id = String(new URLSearchParams(location.search).get("id") || "").trim().toUpperCase();
const draftKey = new URLSearchParams(location.search).get("draft");
const embedded = new URLSearchParams(location.search).get("embedded") === "1";
const certificatePattern = /^NCC-APT-\d{4}-\d{4}$/;
const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);

function dateText(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [year, month, day] = value.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function termText(data) {
  const start = dateText(data.issuedAt);
  const end = dateText(data.validUntil);
  return start && end ? `임명기간은 ${start}부터 ${end}까지 1년입니다.` : "임명기간은 발령일로부터 1년입니다.";
}

function showStatus(title, message) {
  $("#statusMessage").hidden = false;
  $("#statusMessage").innerHTML = `<h1>${title}</h1><p>${message}</p>`;
  $("#certificate").hidden = true;
}

function renderQr(certificateNumber) {
  if (typeof window.qrcode !== "function") throw new Error("QR_GENERATOR_UNAVAILABLE");
  const verificationUrl = `https://ncc365.com/certificate-verify.html?id=${encodeURIComponent(certificateNumber)}`;
  const qr = window.qrcode(0, "M");
  qr.addData(verificationUrl);
  qr.make();
  $("#qrCode").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, title: "NCC 공식 센터확인 QR 코드" });
}

function renderCertificate(data, { preview = false } = {}) {
  $("#recipientName").textContent = data.recipientName || "-";
  $("#role").textContent = data.role || data.representativeName || "센터장";
  $("#region").textContent = data.region || "-";
  $("#termLine").textContent = termText(data);
  $("#issuedAt").textContent = dateText(data.issuedAt) || "-";
  $("#centerCode").textContent = `센터코드  ${data.centerCode || data.selectionNumber || "-"}`;
  $("#certificateNumber").textContent = `임명번호  ${data.certificateNumber || "-"}`;
  renderQr(data.certificateNumber);
  $("#statusMessage").hidden = true;
  $("#certificate").hidden = false;
  if (preview) document.title = "NCC 센터장 임명장 미리보기";
}

async function readDraft(key) {
  try {
    const raw = sessionStorage.getItem(`ncc-center-appointment:${key}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return certificatePattern.test(String(data.certificateNumber || "").toUpperCase()) ? data : null;
  } catch {
    return null;
  }
}

try {
  if (embedded) $("#certificateTools").hidden = true;
  if (draftKey) {
    const draft = await readDraft(draftKey);
    if (!draft) showStatus("미리보기 정보를 찾을 수 없습니다.", "발급관리 화면에서 다시 미리보기를 갱신해 주세요.");
    else renderCertificate(draft, { preview: true });
  } else if (!certificatePattern.test(id)) {
    showStatus("임명번호를 확인해 주세요.", "NCC-APT-연도-일련번호 형식의 공식 임명번호가 필요합니다.");
  } else {
    const snapshot = await getDoc(doc(db, "certificates", id));
    if (!snapshot.exists()) {
      showStatus("등록된 임명장을 찾을 수 없습니다.", "임명번호를 다시 확인해 주세요.");
    } else {
      const data = snapshot.data();
      if (data.certificateType !== "center_appointment" || data.public !== true || data.status !== "active") {
        showStatus("출력할 수 없는 임명장입니다.", "정상 발급 및 공개 상태인 센터장 임명장만 출력할 수 있습니다.");
      } else {
        renderCertificate(data);
      }
    }
  }
} catch (error) {
  console.error(error);
  showStatus("임명장을 불러오지 못했습니다.", "잠시 후 다시 시도해 주세요.");
}
