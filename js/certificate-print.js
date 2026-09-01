import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const id = new URLSearchParams(location.search).get("id") || "";
const $ = (selector) => document.querySelector(selector);
const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);
const verificationUrl = `${location.origin}/certificate-print?id=${encodeURIComponent(id)}`;

const setMessage = (title, message) => {
  $("#title").textContent = title;
  $("#name").textContent = message;
  $("#englishTitle").textContent = "NCC CERTIFICATE VERIFICATION";
  $("#statement").textContent = "인증번호와 발급 상태를 확인한 뒤 정식 인증서를 조회할 수 있습니다.";
  $("#representativeRow").hidden = true;
  $("#categoryRow").hidden = true;
  $("#regionRow").hidden = true;
  $("#issuedAt").textContent = "";
};

const setVerificationQr = () => {
  $("#verifyLink").href = verificationUrl;
  $("#qrCode").src = `https://quickchart.io/qr?size=220&margin=1&text=${encodeURIComponent(verificationUrl)}`;
};

const englishTitleFor = (type) => ({
  business_certificate: "NCC VERIFIED BUSINESS",
  store_certificate: "NCC VERIFIED STORE",
  excellent_company: "CONSUMER CHOICE EXCELLENT COMPANY",
  excellent_product_service: "CONSUMER CHOICE EXCELLENT PRODUCT & SERVICE",
  official_partner: "NCC OFFICIAL PARTNER",
  center_appointment: "NCC CENTER APPOINTMENT",
}[type] || "NATIONAL CONSUMER CLUB CERTIFICATE");

const dateText = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
};

setVerificationQr();

if (!/^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/.test(id)) {
  setMessage("인증번호 확인", "유효한 인증번호 형식이 아닙니다.");
} else {
  const snap = await getDoc(doc(db, "certificates", id));

  if (!snap.exists()) {
    setMessage("인증번호 확인", "등록된 인증서를 찾을 수 없습니다.");
  } else {
    const data = snap.data();

    if (data.public !== true || data.status !== "active") {
      setMessage("발급 대기 인증서", "현재 상태: 검토용 샘플 · 정상 발급 후 출력할 수 있습니다.");
      $("#number").textContent = data.certificateNumber || id;
    } else {
      $("#title").textContent = data.title || "소비자선정 우수기업 인증서";
      $("#englishTitle").textContent = englishTitleFor(data.certificateType);
      $("#name").textContent = data.recipientName || "-";
      $("#representative").textContent = data.representativeName || "해당 없음";
      $("#category").textContent = data.category || "소비자 만족·서비스 품질";
      $("#region").textContent = data.region || "대한민국";
      $("#statement").textContent = `${data.recipientName || "위 사업체"}는 상품과 서비스의 품질, 소비자 만족도 및 소비자 가치 향상을 위한 노력을 종합적으로 평가하여 ${data.title || "소비자선정 우수기업"}으로 선정되었음을 인증합니다.`;
      $("#issuedAt").textContent = dateText(data.issuedAt);
      $("#number").textContent = data.certificateNumber;
      $("#validUntil").textContent = data.validUntil ? `유효기한 ${dateText(data.validUntil)}` : "NCC 공식 진위확인";
      $("#issuer").textContent = data.issuer || "전국소비자클럽 소비자선정위원회";
    }
  }
}
