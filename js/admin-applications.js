import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  query,
  orderBy,
  doc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAIL = "kpa100plus@gmail.com";
const $ = selector => document.querySelector(selector);
const labels = { new: "신규", checking: "확인중", contacted: "연락완료", approved: "승인", hold: "보류" };

let applications = [];

$("#loginButton").onclick = async () => {
  try {
    $("#loginError").textContent = "";
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
  } catch (error) {
    console.error(error);
    $("#loginError").textContent = "로그인 정보를 확인해 주세요.";
  }
};
$("#logoutButton").onclick = () => signOut(auth);
$("#refreshButton").onclick = load;
$("#statusFilter").onchange = render;
$("#searchInput").oninput = render;

onAuthStateChanged(auth, async user => {
  if (user?.email?.toLowerCase() === ADMIN_EMAIL) {
    $("#loginArea").hidden = true;
    $("#adminArea").hidden = false;
    await load();
  } else {
    if (user) await signOut(auth);
    $("#loginArea").hidden = false;
    $("#adminArea").hidden = true;
  }
});

async function load() {
  const area = $("#applicationList");
  area.innerHTML = '<div class="empty">신청내역을 불러오는 중입니다.</div>';
  setStatus("");
  try {
    const snapshot = await getDocs(query(collection(db, "benefitApplications"), orderBy("createdAt", "desc")));
    applications = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    render();
  } catch (error) {
    console.error(error);
    area.innerHTML = '<div class="empty">신청내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>';
  }
}

function render() {
  const status = $("#statusFilter").value;
  const word = $("#searchInput").value.trim().toLowerCase();
  const filtered = applications.filter(application =>
    (status === "all" || application.status === status)
    && (!word || [application.name, application.phone, application.region, application.offerTitle, application.type, application.receipt].some(value => String(value || "").toLowerCase().includes(word)))
  );
  $("#totalCount").textContent = applications.length;
  $("#newCount").textContent = applications.filter(application => application.status === "new").length;
  $("#progressCount").textContent = applications.filter(application => ["checking", "contacted"].includes(application.status)).length;
  $("#doneCount").textContent = applications.filter(application => application.status === "approved").length;
  $("#applicationList").innerHTML = filtered.length ? filtered.map(card).join("") : '<div class="empty">조건에 맞는 신청내역이 없습니다.</div>';
  document.querySelectorAll("[data-save]").forEach(button => button.onclick = save);
}

function card(application) {
  const created = application.createdAt?.toDate ? application.createdAt.toDate().toLocaleString("ko-KR") : "방금 접수";
  const alert = application.type === "모집 알림 신청";
  return `<article class="application-card">
    <div>
      <p class="receipt">${esc(application.receipt || application.id)} · ${created}</p>
      <h2>${esc(application.offerTitle)} <small>${esc(application.type)}</small></h2>
      <div class="meta"><b>${esc(application.name)}</b><span>${esc(application.phone)}</span><span>${esc(application.region)}</span></div>
      <p class="message">${esc(application.message || "신청 내용 없음")}</p>
      <p class="notification-note">${alert ? "승인으로 저장하면 모집 시작 안내가" : "상태를 저장하면 처리 안내가"} 회원의 NCC 월렛 알림함에 표시됩니다.</p>
    </div>
    <div class="card-actions">
      <select id="status-${application.id}" aria-label="${esc(application.offerTitle)} 처리상태">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${application.status === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      <button data-save="${application.id}">상태 저장</button>
    </div>
  </article>`;
}

function notificationContent(application, status) {
  const title = application.offerTitle || "NCC 혜택";
  if (status === "checking") return { title: "혜택 신청 확인 중", message: `${title} 신청내용을 확인하고 있습니다.` };
  if (status === "contacted") return { title: "혜택 안내 연락 완료", message: `${title} 관련 안내를 등록 연락처로 진행했습니다.` };
  if (status === "hold") return { title: "혜택 신청 보류 안내", message: `${title} 신청이 현재 보류 상태입니다. 자세한 내용은 NCC 본사 안내를 확인해 주세요.` };
  if (application.type === "모집 알림 신청") return { title: "모집 시작 안내", message: `${title} 모집이 시작되었습니다. 혜택 상세에서 참여조건과 신청 가능 여부를 확인해 주세요.` };
  return { title: "혜택 신청 승인", message: `${title} 신청이 승인되었습니다. 혜택 상세와 NCC 안내를 확인해 주세요.` };
}

async function save(event) {
  const button = event.currentTarget;
  const id = button.dataset.save;
  const target = applications.find(application => application.id === id);
  if (!target) return;
  const status = $(`#status-${id}`).value;
  button.disabled = true;
  button.textContent = "저장 중...";
  setStatus("");

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "benefitApplications", id), { status, updatedAt: serverTimestamp() });

    let notificationCreated = false;
    if (target.memberId && status !== "new") {
      const notificationRef = doc(db, "memberNotifications", `benefit-${id}-${status}`);
      const notificationSnapshot = await getDoc(notificationRef);
      const content = notificationContent(target, status);
      const payload = {
        memberId: target.memberId,
        applicationId: id,
        offerId: target.offerId || "",
        offerTitle: target.offerTitle || "NCC 혜택",
        applicationType: target.type || "혜택 참여 신청",
        status,
        title: content.title,
        message: content.message,
        href: `benefit-detail.html?id=${encodeURIComponent(target.offerId || "")}`,
        updatedAt: serverTimestamp()
      };
      if (!notificationSnapshot.exists()) {
        payload.read = false;
        payload.createdAt = serverTimestamp();
      }
      batch.set(notificationRef, payload, { merge: true });
      notificationCreated = true;
    }

    await batch.commit();
    target.status = status;
    render();
    setStatus(notificationCreated
      ? `${target.receipt || "신청"} 상태를 ${labels[status]}(으)로 저장하고 NCC 월렛 알림을 반영했습니다.`
      : `${target.receipt || "신청"} 상태를 ${labels[status]}(으)로 저장했습니다. 신규 상태 또는 이전 형식 신청은 알림을 만들지 않습니다.`
    );
  } catch (error) {
    console.error(error);
    setStatus("상태를 저장하지 못했습니다. Firestore 권한과 통신 상태를 확인해 주세요.", true);
  } finally {
    button.disabled = false;
    button.textContent = "상태 저장";
  }
}

function setStatus(text, error = false) {
  const node = $("#adminStatusMessage");
  node.textContent = text;
  node.classList.toggle("error", error);
}

function esc(value) {
  return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
