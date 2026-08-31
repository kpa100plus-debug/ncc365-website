import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const id = new URLSearchParams(location.search).get("id") || "";
const $ = (selector) => document.querySelector(selector);
const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);

const setMessage = (title, message) => {
  $("#title").textContent = title;
  $("#name").textContent = message;
};

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
      $("#detail").textContent = data.certificateNumber || id;
    } else {
      $("#title").textContent = data.title;
      $("#name").textContent = data.recipientName;
      $("#detail").textContent = [
        data.category,
        data.region,
        data.issuedAt && `발급일 ${data.issuedAt}`,
      ].filter(Boolean).join(" · ");
      $("#number").textContent = data.certificateNumber;
      $("#issuer").textContent = data.issuer || "NCC 전국소비자클럽";
    }
  }
}
