import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN = "kpa100plus@gmail.com";
const CERTIFICATE_TYPE = "center_appointment";
const CERTIFICATE_PATTERN = /^NCC-APT-\d{4}-\d{4}$/;
const $ = selector => document.querySelector(selector);
const form = $("#appointmentForm");
const message = $("#appointmentMessage");
let appointments = [];
let managers = [];
let previewTimer;

const statusLabels = { active: "정상 발급", revoked: "취소", expired: "유효기간 만료", sample: "검토용 샘플" };
const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const normalize = value => String(value || "").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
const dateInput = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : "";

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function plusOneYear(value) {
  if (!dateInput(value)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year + 1, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function dateText(value) {
  if (!dateInput(value)) return "";
  const [year, month, day] = value.split("-");
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function getTermText(issuedAt, validUntil) {
  const start = dateText(issuedAt);
  const end = dateText(validUntil);
  return start && end ? `${start}부터 ${end}까지 (1년)` : "발령일로부터 1년";
}

function nextCertificateNumber(issuedAt) {
  const year = dateInput(issuedAt) ? issuedAt.slice(0, 4) : String(new Date().getFullYear());
  const matcher = new RegExp(`^NCC-APT-${year}-(\\d{4})$`);
  const highest = appointments.reduce((max, item) => {
    const hit = normalize(item.certificateNumber).match(matcher);
    return hit ? Math.max(max, Number(hit[1])) : max;
  }, 0);
  return `NCC-APT-${year}-${String(highest + 1).padStart(4, "0")}`;
}

function syncDateAndNumber({ preserveNumber = false } = {}) {
  const issuedAt = dateInput(form.elements.issuedAt.value) || localToday();
  const validUntil = plusOneYear(issuedAt);
  form.elements.issuedAt.value = issuedAt;
  form.elements.validUntil.value = validUntil;
  form.elements.termText.value = getTermText(issuedAt, validUntil);
  if (!preserveNumber) form.elements.certificateNumber.value = nextCertificateNumber(issuedAt);
}

function draftData() {
  const data = Object.fromEntries(new FormData(form));
  return {
    certificateNumber: normalize(data.certificateNumber),
    recipientName: String(data.recipientName || "").trim(),
    role: String(data.role || "").trim(),
    region: String(data.region || "").trim(),
    centerCode: normalize(data.centerCode),
    issuedAt: dateInput(data.issuedAt),
    validUntil: dateInput(data.validUntil)
  };
}

function isDraftReady(data = draftData()) {
  return CERTIFICATE_PATTERN.test(data.certificateNumber)
    && Boolean(data.recipientName && data.role && data.region && data.centerCode && data.issuedAt && data.validUntil);
}

function previewKey() {
  return window.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function refreshPreview({ announce = false } = {}) {
  const data = draftData();
  if (!isDraftReady(data)) {
    if (announce) setMessage("미리보기를 보려면 성명·직책·담당지역·센터코드·발령일을 모두 입력해 주세요.", true);
    return false;
  }
  const key = previewKey();
  sessionStorage.setItem(`ncc-center-appointment:${key}`, JSON.stringify(data));
  const preview = $("#appointmentPreview");
  preview.src = `center-manager-certificate-print.html?draft=${encodeURIComponent(key)}&embedded=1`;
  if (announce) setMessage("발급 전 A4 미리보기를 갱신했습니다.");
  return true;
}

function queuePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (isDraftReady()) refreshPreview();
  }, 350);
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function managerLabel(member) {
  const name = String(member.name || "성명 미등록").trim();
  const region = String(member.region || member.centerName || "담당지역 미등록").trim();
  return `${name} · ${member.memberNumber || "회원번호 없음"} · ${region}`;
}

function renderManagers() {
  const select = $("#managerSelect");
  select.replaceChildren(new Option("센터장 회원을 선택하거나 직접 입력", ""));
  managers.forEach(member => select.add(new Option(managerLabel(member), member.id)));
}

function fillManager(member) {
  if (!member) return;
  form.elements.recipientName.value = String(member.name || "").trim();
  form.elements.role.value = String(member.role || "센터장").trim() || "센터장";
  form.elements.region.value = String(member.region || member.centerName || "").trim();
  form.elements.centerCode.value = normalize(member.centerCode);
  $("#memberLookupMessage").textContent = `${member.memberNumber || "선택 회원"}의 센터장 정보를 적용했습니다. 필요한 경우 발급 항목을 수정할 수 있습니다.`;
  setMessage("선택한 센터장 회원의 정보를 입력했습니다.");
  queuePreview();
}

async function loadManagers() {
  const button = $("#loadManagersButton");
  button.disabled = true;
  button.textContent = "불러오는 중...";
  try {
    const snapshot = await getDocs(collection(db, "members"));
    managers = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.memberType === "center_manager")
      .sort((a, b) => managerLabel(a).localeCompare(managerLabel(b), "ko"));
    renderManagers();
    $("#memberLookupMessage").textContent = managers.length
      ? `${managers.length}명의 센터장 회원을 불러왔습니다. 회원을 선택하거나 직접 입력할 수 있습니다.`
      : "등록된 센터장 회원이 없습니다. 성명·직책·담당지역을 직접 입력해 발급할 수 있습니다.";
  } catch (error) {
    console.error(error);
    setMessage("센터장 회원 목록을 불러오지 못했습니다. 직접 입력하거나 관리자 권한을 확인해 주세요.", true);
  } finally {
    button.disabled = false;
    button.textContent = "센터장 회원 목록 불러오기";
  }
}

function byCreated(a, b) {
  return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
}

async function loadHistory({ quiet = false } = {}) {
  try {
    const snapshot = await getDocs(collection(db, "certificates"));
    appointments = snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => item.certificateType === CERTIFICATE_TYPE)
      .sort(byCreated);
    syncDateAndNumber();
    renderHistory();
    if (!quiet) setMessage("센터장 임명장 발급이력을 새로고침했습니다.");
  } catch (error) {
    console.error(error);
    $("#historyList").innerHTML = '<div class="empty">발급이력을 불러오지 못했습니다. Firestore 권한을 확인해 주세요.</div>';
    setMessage("발급이력을 불러오지 못했습니다.", true);
  }
}

function renderHistory() {
  const status = $("#statusFilter").value;
  const keyword = $("#historySearch").value.trim().toLowerCase();
  const filtered = appointments.filter(item =>
    (status === "all" || item.status === status)
    && (!keyword || [item.certificateNumber, item.recipientName, item.region, item.selectionNumber]
      .some(value => String(value || "").toLowerCase().includes(keyword)))
  );
  $("#historyList").innerHTML = filtered.length ? filtered.map(item => `
    <article class="application-card history-card">
      <div>
        <p class="receipt">${escapeHtml(item.certificateNumber)} · 센터장 임명장</p>
        <h2>${escapeHtml(item.recipientName)} <small class="certificate-status-${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || "오류")}</small></h2>
        <div class="meta"><span>${escapeHtml(item.representativeName || "센터장")}</span><span>${escapeHtml(item.region)}</span><span>센터코드 ${escapeHtml(item.selectionNumber)}</span><span>발령일 ${escapeHtml(item.issuedAt)}</span><span>종료일 ${escapeHtml(item.validUntil)}</span></div>
      </div>
      <div class="card-actions">
        <a href="center-manager-certificate-print.html?id=${encodeURIComponent(item.certificateNumber)}" target="_blank" rel="noopener">재출력·PDF</a>
        <a href="certificate-verify.html?id=${encodeURIComponent(item.certificateNumber)}" target="_blank" rel="noopener">공개 진위확인</a>
        ${item.status === "active" ? `<button class="cancel" type="button" data-cancel="${escapeHtml(item.id)}">발급 취소</button>` : ""}
      </div>
    </article>`).join("") : '<div class="empty">조건에 맞는 센터장 임명장 발급기록이 없습니다.</div>';
  document.querySelectorAll("[data-cancel]").forEach(button => {
    button.addEventListener("click", () => cancelAppointment(button.dataset.cancel));
  });
}

async function cancelAppointment(id) {
  const item = appointments.find(candidate => candidate.id === id);
  if (!item || item.status !== "active") return;
  if (!window.confirm(`${item.recipientName} 님의 ${item.certificateNumber} 임명장을 취소할까요?\n취소 후 공개 진위확인에는 취소 상태로 표시됩니다.`)) return;
  const button = document.querySelector(`[data-cancel="${CSS.escape(id)}"]`);
  if (button) { button.disabled = true; button.textContent = "취소 처리 중..."; }
  try {
    const { id: ignored, ...payload } = item;
    const batch = writeBatch(db);
    batch.set(doc(db, "certificates", item.certificateNumber), { ...payload, status: "revoked", updatedAt: serverTimestamp() }, { merge: true });
    batch.set(doc(collection(db, "certificateLogs")), {
      certificateNumber: item.certificateNumber,
      eventType: "updated",
      status: "revoked",
      public: item.public === true,
      actorEmail: auth.currentUser.email,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    await loadHistory({ quiet: true });
    setMessage(`${item.certificateNumber} 임명장을 취소 처리했습니다. 공개 진위확인에는 취소로 표시됩니다.`);
  } catch (error) {
    console.error(error);
    setMessage("임명장 취소 처리에 실패했습니다. 관리자 권한과 통신 상태를 확인해 주세요.", true);
    if (button) { button.disabled = false; button.textContent = "발급 취소"; }
  }
}

function certificatePayload() {
  const draft = draftData();
  return {
    certificateNumber: draft.certificateNumber,
    certificateType: CERTIFICATE_TYPE,
    title: "센터장 임명장",
    recipientName: draft.recipientName,
    representativeName: draft.role,
    selectionNumber: draft.centerCode,
    category: "센터장",
    region: draft.region,
    evaluationGroup: `임명기간 ${getTermText(draft.issuedAt, draft.validUntil)}`,
    issuedAt: draft.issuedAt,
    validUntil: draft.validUntil,
    issuer: "전국소비자클럽 중앙운영위원회",
    imageUrl: "",
    status: "active",
    public: true
  };
}

async function issueAppointment(event) {
  event.preventDefault();
  syncDateAndNumber({ preserveNumber: true });
  const data = draftData();
  if (!form.reportValidity() || !isDraftReady(data)) {
    setMessage("성명·직책·담당지역·센터코드·발령일을 확인해 주세요.", true);
    return;
  }
  const submit = $("#issueButton");
  submit.disabled = true;
  setMessage("센터장 임명장을 발급하고 있습니다.");
  try {
    const payload = certificatePayload();
    const target = doc(db, "certificates", payload.certificateNumber);
    const existing = await getDoc(target);
    if (existing.exists()) {
      await loadHistory({ quiet: true });
      setMessage("같은 임명번호가 이미 존재합니다. 임명번호를 새로고침한 뒤 다시 발급해 주세요.", true);
      return;
    }
    const batch = writeBatch(db);
    batch.set(target, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, "certificateLogs")), {
      certificateNumber: payload.certificateNumber,
      eventType: "created",
      status: "active",
      public: true,
      actorEmail: auth.currentUser.email,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    await loadHistory({ quiet: true });
    setMessage(`${payload.certificateNumber} 임명장을 정상 발급했습니다. 발급이력에서 재출력·PDF 저장과 공개 진위확인을 사용할 수 있습니다.`);
    refreshPreview();
  } catch (error) {
    console.error(error);
    setMessage("임명장을 발급하지 못했습니다. 관리자 권한과 통신 상태를 확인해 주세요.", true);
  } finally {
    submit.disabled = false;
  }
}

$("#loginButton").addEventListener("click", async () => {
  try {
    $("#loginError").textContent = "";
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
  } catch {
    $("#loginError").textContent = "로그인 정보를 확인해 주세요.";
  }
});
$("#logoutButton").addEventListener("click", () => signOut(auth));
$("#loadManagersButton").addEventListener("click", loadManagers);
$("#managerSelect").addEventListener("change", event => fillManager(managers.find(item => item.id === event.target.value)));
$("#previewButton").addEventListener("click", () => refreshPreview({ announce: true }));
$("#refreshHistoryButton").addEventListener("click", () => loadHistory());
$("#statusFilter").addEventListener("change", renderHistory);
$("#historySearch").addEventListener("input", renderHistory);
form.addEventListener("submit", issueAppointment);
form.addEventListener("input", event => {
  if (event.target.name === "issuedAt") syncDateAndNumber();
  queuePreview();
});
form.addEventListener("change", event => {
  if (event.target.name === "issuedAt") syncDateAndNumber();
  queuePreview();
});

onAuthStateChanged(auth, async user => {
  if (user?.email?.toLowerCase() !== ADMIN) {
    if (user) await signOut(auth);
    $("#loginArea").hidden = false;
    $("#adminArea").hidden = true;
    return;
  }
  $("#loginArea").hidden = true;
  $("#adminArea").hidden = false;
  syncDateAndNumber();
  await loadHistory({ quiet: true });
});
