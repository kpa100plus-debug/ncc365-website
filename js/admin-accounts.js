import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, getFirestore, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAIL = "kpa100plus@gmail.com";
const $ = selector => document.querySelector(selector);
const statusLabels = { requested: "접수", reviewing: "검토 중", approved: "승인", rejected: "반려" };
const disposalLabels = { not_started: "파기 전", scheduled: "최종 파기 대기", not_applicable: "파기 대상 아님" };
const eventLabels = {
  basic_profile_updated: "기본정보 변경", email_synced: "이메일 변경 완료",
  email_change_requested: "이메일 변경 요청", password_reset_requested: "비밀번호 재설정 요청",
  deletion_requested: "탈퇴 요청", deletion_reviewing: "탈퇴 검토",
  deletion_approved: "탈퇴 승인", deletion_rejected: "탈퇴 반려",
  admin_role_updated: "관리자 역할·소속 변경"
};
let requests = [];
let logs = [];
let membersById = new Map();

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const timestampValue = value => value?.toMillis?.() || 0;
const formatTime = value => {
  const date = value?.toDate?.();
  return date ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date) : "기록 대기";
};
const compactValue = value => {
  if (value == null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${item ?? "-"}`).join(" · ");
  return String(value);
};

$("#adminLoginButton").addEventListener("click", async () => {
  $("#adminAccountMessage").textContent = "로그인 중입니다.";
  try {
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
    $("#adminPassword").value = "";
  } catch (error) {
    console.error(error);
    $("#adminAccountMessage").textContent = "관리자 로그인 정보를 확인해 주세요.";
  }
});
$("#adminLogoutButton").addEventListener("click", () => signOut(auth));
$("#accountRefresh").addEventListener("click", loadAll);
$("#logRefresh").addEventListener("click", loadAll);
$("#requestSearch").addEventListener("input", renderRequests);
$("#requestStatus").addEventListener("change", renderRequests);
$("#logSearch").addEventListener("input", renderLogs);
$("#logType").addEventListener("change", renderLogs);
document.querySelectorAll("[data-account-tab]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.accountTab)));

onAuthStateChanged(auth, async user => {
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
  $("#adminAccountLogin").hidden = isAdmin;
  $("#adminAccountArea").hidden = !isAdmin;
  if (user && !isAdmin) await signOut(auth);
  if (isAdmin) await loadAll();
});

function switchTab(name) {
  document.querySelectorAll("[data-account-tab]").forEach(button => button.classList.toggle("active", button.dataset.accountTab === name));
  $("#requestPanel").hidden = name !== "requests";
  $("#logPanel").hidden = name !== "logs";
}

async function loadAll() {
  $("#requestList").innerHTML = '<div class="role-empty">탈퇴요청을 불러오고 있습니다.</div>';
  $("#logList").innerHTML = '<div class="role-empty">계정변경 로그를 불러오고 있습니다.</div>';
  try {
    const [requestSnapshot, logSnapshot, memberSnapshot] = await Promise.all([
      getDocs(collection(db, "accountDeletionRequests")),
      getDocs(collection(db, "accountChangeLogs")),
      getDocs(collection(db, "members"))
    ]);
    requests = requestSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
    logs = logSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
    membersById = new Map(memberSnapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    renderSummary();
    renderRequests();
    renderLogs();
  } catch (error) {
    console.error(error);
    $("#requestList").innerHTML = '<div class="role-empty">탈퇴요청을 불러오지 못했습니다. 관리자 권한을 확인해 주세요.</div>';
    $("#logList").innerHTML = '<div class="role-empty">계정변경 로그를 불러오지 못했습니다.</div>';
  }
}

function renderSummary() {
  $("#totalRequests").textContent = requests.length;
  $("#pendingRequests").textContent = requests.filter(item => ["requested", "reviewing"].includes(item.status)).length;
  $("#approvedRequests").textContent = requests.filter(item => item.status === "approved").length;
  $("#rejectedRequests").textContent = requests.filter(item => item.status === "rejected").length;
}

function renderRequests() {
  const word = $("#requestSearch").value.trim().toLowerCase();
  const status = $("#requestStatus").value;
  const filtered = requests.filter(request => {
    const member = membersById.get(request.memberId) || {};
    const searchable = [request.name, request.memberNumber, request.email, member.phone, request.reason].join(" ").toLowerCase();
    return (!status || request.status === status) && (!word || searchable.includes(word));
  });
  $("#requestList").innerHTML = filtered.length ? filtered.map(requestCard).join("") : '<div class="role-empty">조건에 맞는 탈퇴요청이 없습니다.</div>';
  document.querySelectorAll("[data-request-action]").forEach(button => button.addEventListener("click", processRequest));
}

function requestCard(request) {
  const member = membersById.get(request.memberId) || {};
  const disabled = request.status === "approved" ? "disabled" : "";
  return `<article class="request-card">
    <div class="request-head"><div><h3>${escapeHtml(request.name || member.name || "회원")}</h3><p>${escapeHtml(request.memberNumber || member.memberNumber)} · ${escapeHtml(request.email || member.email)}</p></div><span class="audit-chip">${escapeHtml(statusLabels[request.status] || request.status)}</span></div>
    <div class="request-meta"><span>요청 ${escapeHtml(formatTime(request.createdAt))}</span><span>계정 ${escapeHtml(member.status || "확인 필요")}</span><span>${escapeHtml(disposalLabels[request.privacyDisposalStatus || "not_started"])}</span></div>
    <div class="request-reason"><b>탈퇴 사유</b><br>${escapeHtml(request.reason || "사유 미입력")}</div>
    <div class="request-controls"><label>처리 상태<select id="request-status-${request.id}" ${disabled}><option value="reviewing" ${request.status === "reviewing" ? "selected" : ""}>검토 중</option><option value="approved" ${request.status === "approved" ? "selected" : ""}>승인</option><option value="rejected" ${request.status === "rejected" ? "selected" : ""}>반려</option></select></label><label>관리자 처리 메모<textarea id="request-memo-${request.id}" maxlength="1000" placeholder="승인·반려 사유와 후속조치를 기록하세요." ${disabled}>${escapeHtml(request.adminMemo || "")}</textarea></label></div>
    <div class="request-actions"><button class="account-action primary" type="button" data-request-action="${request.id}" ${disabled}>선택 상태 저장</button></div>
    <p class="privacy-note">탈퇴 승인 시 홈페이지 이용을 차단하고 최종 개인정보 파기 대기로 기록합니다. Authentication 계정 및 법정 보존자료의 최종 삭제는 별도 관리자 보안처리 후 완료해야 합니다.</p>
  </article>`;
}

async function processRequest(event) {
  const button = event.currentTarget;
  const request = requests.find(item => item.id === button.dataset.requestAction);
  if (!request) return;
  const nextStatus = $("#request-status-" + request.id).value;
  const adminMemo = $("#request-memo-" + request.id).value.trim();
  if (!adminMemo) { $("#requestMessage").textContent = "처리 근거를 남기기 위해 관리자 메모를 입력해 주세요."; return; }
  const actionText = statusLabels[nextStatus] || nextStatus;
  if (!confirm(`${request.name || "회원"}의 탈퇴요청을 '${actionText}' 상태로 처리하시겠습니까?${nextStatus === "approved" ? "\n승인 즉시 해당 회원의 홈페이지 이용이 차단됩니다." : ""}`)) return;
  button.disabled = true;
  $("#requestMessage").textContent = "탈퇴요청을 처리하고 기록을 저장하고 있습니다.";
  try {
    const member = membersById.get(request.memberId) || {};
    const batch = writeBatch(db);
    const nextDisposal = nextStatus === "approved" ? "scheduled" : nextStatus === "rejected" ? "not_applicable" : "not_started";
    const requestUpdate = {
      status: nextStatus, privacyDisposalStatus: nextDisposal, adminMemo,
      reviewedBy: auth.currentUser.email, reviewedAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    if (nextStatus === "approved" && !request.previousMemberStatus) requestUpdate.previousMemberStatus = member.status || "active";
    batch.update(doc(db, "accountDeletionRequests", request.id), requestUpdate);
    if (nextStatus === "approved") batch.update(doc(db, "members", request.memberId), { status: "blocked", accountDeletionStatus: "approved", updatedAt: serverTimestamp() });
    if (nextStatus === "rejected" && request.status === "approved" && member.status === "blocked") batch.update(doc(db, "members", request.memberId), { status: request.previousMemberStatus || "active", accountDeletionStatus: "rejected", updatedAt: serverTimestamp() });
    const logRef = doc(collection(db, "accountChangeLogs"));
    batch.set(logRef, {
      memberId: request.memberId, memberNumber: request.memberNumber || member.memberNumber || "", memberName: request.name || member.name || "회원",
      actorUid: auth.currentUser.uid, actorEmail: auth.currentUser.email, actorType: "admin",
      eventType: `deletion_${nextStatus}`, changedFields: ["탈퇴요청 상태", ...(nextStatus === "approved" ? ["회원계정 상태", "개인정보 파기 상태"] : ["개인정보 파기 상태"])],
      before: { requestStatus: request.status || "requested", memberStatus: member.status || "unknown", privacyDisposalStatus: request.privacyDisposalStatus || "not_started" },
      after: { requestStatus: nextStatus, memberStatus: nextStatus === "approved" ? "blocked" : member.status || "unknown", privacyDisposalStatus: nextDisposal },
      description: adminMemo, createdAt: serverTimestamp()
    });
    await batch.commit();
    $("#requestMessage").textContent = `${request.name || "회원"} 탈퇴요청을 ${actionText} 처리했습니다.`;
    await loadAll();
  } catch (error) {
    console.error(error);
    $("#requestMessage").textContent = "처리하지 못했습니다. Firestore 관리자 권한과 회원정보를 확인해 주세요.";
    button.disabled = false;
  }
}

function renderLogs() {
  const word = $("#logSearch").value.trim().toLowerCase();
  const type = $("#logType").value;
  const filtered = logs.filter(log => {
    const searchable = [log.memberName, log.memberNumber, log.actorEmail, eventLabels[log.eventType], ...(log.changedFields || [])].join(" ").toLowerCase();
    return (!type || log.eventType === type) && (!word || searchable.includes(word));
  });
  $("#logList").innerHTML = filtered.length ? filtered.map(logItem).join("") : '<div class="role-empty">조건에 맞는 계정변경 로그가 없습니다.</div>';
}

function logItem(log) {
  return `<article class="audit-item"><div class="audit-time">${escapeHtml(formatTime(log.createdAt))}</div><div class="audit-main"><h3>${escapeHtml(log.memberName || "회원")} · ${escapeHtml(log.memberNumber || "번호 없음")}</h3><p><span class="audit-chip">${escapeHtml(eventLabels[log.eventType] || log.eventType)}</span> ${escapeHtml((log.changedFields || []).join(", "))}</p><p>처리자: ${escapeHtml(log.actorType === "admin" ? "관리자" : "회원 본인")} · ${escapeHtml(log.actorEmail || "")}</p>${log.description ? `<p>${escapeHtml(log.description)}</p>` : ""}<div class="audit-values"><b>변경 전</b> ${escapeHtml(compactValue(log.before))}<br><b>변경 후</b> ${escapeHtml(compactValue(log.after))}</div></div></article>`;
}
