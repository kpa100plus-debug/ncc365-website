import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const params = new URLSearchParams(location.search);
const id = params.get("id") || "";
const reviewMode = params.get("review") === "1";
const $ = (selector) => document.querySelector(selector);
const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);

const verificationUrl = `${location.origin}/certificate-verify.html?id=${encodeURIComponent(id)}`;

const showStatus = (title, message) => {
  $("#statusMessage").hidden = false;
  $("#statusMessage").innerHTML = `<h1>${title}</h1><p>${message}</p>`;
  $("#certificate").hidden = true;
};

const setReviewMode = (data) => {
  const banner = $("#reviewBanner");
  if (!reviewMode || !banner) return;
  banner.hidden = false;
  banner.textContent = data.status === "sample"
    ? "검토용 샘플 · 공식 발급본 아님"
    : "관리자 검토 미리보기";
  document.title = "NCC 인증서 검토 미리보기";
};

const dateText = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
};

const renderQr = () => {
  if (typeof window.qrcode !== "function") throw new Error("QR_GENERATOR_UNAVAILABLE");
  const qr = window.qrcode(0, "M");
  qr.addData(verificationUrl);
  qr.make();
  $("#qrCode").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true, title: "NCC 공식 진위확인 QR 코드" });
};

// Do not expose the A4 sheet until the reference artwork has finished decoding.
// This prevents a slow image stream from showing only the upper fragment of the
// certificate while the dynamic certificate data is already visible.
const waitForTemplate = async () => {
  const image = document.querySelector(".template");
  if (!image) throw new Error("CERTIFICATE_TEMPLATE_MISSING");
  if (!image.complete) {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    });
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("CERTIFICATE_TEMPLATE_UNAVAILABLE");
  if (typeof image.decode === "function") await image.decode();
};

try {
  if (!/^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/.test(id)) {
    showStatus("인증번호를 확인해 주세요.", "공식 인증번호 형식이 아닙니다.");
  } else {
    const snap = await getDoc(doc(db, "certificates", id));
    if (!snap.exists()) {
      showStatus("등록된 인증서를 찾을 수 없습니다.", "인증번호를 다시 확인해 주세요.");
    } else {
      const data = snap.data();
      const isOfficial = data.public === true && data.status === "active";
      const isReviewableSample = reviewMode && data.public === true && data.status === "sample";
      if (!isOfficial && !isReviewableSample) {
        showStatus("공개 출력할 수 없는 인증서입니다.", "정상 발급 및 공개 처리 후 공식 인증서가 표시됩니다.");
      } else {
        $("#name").textContent = data.recipientName || "-";
        $("#representative").textContent = data.representativeName || "-";
        $("#selectionNumber").textContent = data.selectionNumber || "선정번호 미입력";
        $("#category").textContent = data.category || "-";
        $("#region").textContent = data.region || "-";
        $("#issuedAt").textContent = dateText(data.issuedAt) || "-";
        $("#number").textContent = `인증번호 ${data.certificateNumber}`;
        setReviewMode(data);
        renderQr();
        $("#statusMessage").hidden = true;
        $("#certificate").hidden = false;
      }
    }
  }
} catch {
  showStatus("인증서를 불러오지 못했습니다.", "잠시 후 다시 시도해 주세요.");
}
