import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, deleteField, doc, getDocs, getFirestore, query, serverTimestamp, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAIL = "kpa100plus@gmail.com";
const ADMIN_NAME = "juyoungkim";
const $ = selector => document.querySelector(selector);
const statusLabels = { requested: "접수", reviewing: "검토 중", approved: "탈퇴 처리 중", completed: "파기 완료", rejected: "반려" };
const memberStatusLabels = { active: "활성", paused: "일시 정지", blocked: "블랙리스트 차단", withdrawal_pending: "탈퇴 처리 중", withdrawn: "탈퇴 완료" };
const disposalLabels = { not_started: "파기 전", scheduled: "최종 파기 대기", completed: "개인정보 파기 완료", not_applicable: "파기 대상 아님" };
const restrictionLabels = { none: "제한 없음", watchlist: "주의회원", paused: "일시 정지", blacklist: "블랙리스트" };
const eventLabels = {
  basic_profile_updated: "기본정보 변경", email_synced: "이메일 변경 완료",
  email_change_requested: "이메일 변경 요청", password_reset_requested: "비밀번호 재설정 요청",
  deletion_requested: "탈퇴 요청", deletion_reviewing: "탈퇴 검토",
  deletion_approved: "탈퇴 승인", deletion_completed: "탈퇴·파기 완료", deletion_rejected: "탈퇴 반려",
  restriction_watchlist: "주의회원 지정", restriction_paused: "회원 일시 정지",
  restriction_blacklisted: "블랙리스트 차단", restriction_released: "회원 제한 해제",
  admin_role_updated: "관리자 역할·소속 변경"
};
let requests = [];
let logs = [];
let restrictionsById = new Map();
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
const emailBlockKey = async value => {
  const bytes = new TextEncoder().encode(String(value || "").trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
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
$("#restrictionRefresh").addEventListener("click", loadAll);
$("#logRefresh").addEventListener("click", loadAll);
$("#requestSearch").addEventListener("input", renderRequests);
$("#requestStatus").addEventListener("change", renderRequests);
$("#restrictionSearch").addEventListener("input", renderRestrictions);
$("#restrictionStatus").addEventListener("change", renderRestrictions);
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
  $("#restrictionPanel").hidden = name !== "restrictions";
  $("#logPanel").hidden = name !== "logs";
}

async function loadAll() {
  $("#requestList").innerHTML = '<div class="role-empty">탈퇴요청을 불러오고 있습니다.</div>';
  $("#restrictionList").innerHTML = '<div class="role-empty">회원 제한정보를 불러오고 있습니다.</div>';
  $("#logList").innerHTML = '<div class="role-empty">계정변경 로그를 불러오고 있습니다.</div>';
  try {
    const [requestSnapshot, logSnapshot, memberSnapshot, restrictionSnapshot] = await Promise.all([
      getDocs(collection(db, "accountDeletionRequests")),
      getDocs(collection(db, "accountChangeLogs")),
      getDocs(collection(db, "members")),
      getDocs(collection(db, "memberRestrictions"))
    ]);
    requests = requestSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
    logs = logSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => timestampValue(b.createdAt) - timestampValue(a.createdAt));
    membersById = new Map(memberSnapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    restrictionsById = new Map(restrictionSnapshot.docs.map(item => [item.id, { id: item.id, ...item.data() }]));
    renderSummary();
    renderRequests();
    renderRestrictions();
    renderLogs();
  } catch (error) {
    console.error(error);
    $("#requestList").innerHTML = '<div class="role-empty">탈퇴요청을 불러오지 못했습니다. 관리자 권한을 확인해 주세요.</div>';
    $("#restrictionList").innerHTML = '<div class="role-empty">회원 제한정보를 불러오지 못했습니다.</div>';
    $("#logList").innerHTML = '<div class="role-empty">계정변경 로그를 불러오지 못했습니다.</div>';
  }
}

function renderSummary() {
  $("#totalRequests").textContent = requests.length;
  $("#pendingRequests").textContent = requests.filter(item => ["requested", "reviewing"].includes(item.status)).length;
  $("#approvedRequests").textContent = requests.filter(item => item.status === "approved").length;
  $("#completedRequests").textContent = requests.filter(item => item.status === "completed").length;
  $("#restrictedMembers").textContent = [...membersById.values()].filter(item => ["paused", "blocked"].includes(item.status) || restrictionsById.get(item.id)?.level === "watchlist").length;
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
  document.querySelectorAll("[data-finalize-action]").forEach(button => button.addEventListener("click", finalizeWithdrawal));
}

function requestCard(request) {
  const member = membersById.get(request.memberId) || {};
  const completed = request.status === "completed";
  const memberStatus = memberStatusLabels[member.status] || member.status || "확인 필요";
  const reviewControls = completed ? "" : `<div class="request-controls"><label>처리 상태<select id="request-status-${request.id}"><option value="reviewing" ${request.status === "reviewing" ? "selected" : ""}>검토 중</option><option value="approved" ${request.status === "approved" ? "selected" : ""}>탈퇴 승인</option><option value="rejected" ${request.status === "rejected" ? "selected" : ""}>반려</option></select></label><label>관리자 처리 메모<textarea id="request-memo-${request.id}" maxlength="1000" placeholder="승인·반려 사유와 후속조치를 기록하세요.">${escapeHtml(request.adminMemo || "")}</textarea></label></div><div class="request-actions"><button class="account-action primary" type="button" data-request-action="${request.id}">선택 상태 저장</button></div>`;
  const finalControls = request.status === "approved" ? `<div class="finalize-box"><b>최종 파기·재가입 허용</b><p>Firebase Authentication에서 이 회원의 로그인 계정을 먼저 삭제한 뒤 실행하세요. 실행하면 회원 개인정보·주소·연락처 중복잠금을 파기하고 동일 이메일·연락처 재가입을 허용합니다.</p><label><input id="auth-deleted-${request.id}" type="checkbox"> Firebase Authentication 계정 삭제를 완료했습니다.</label><button class="account-action danger" type="button" data-finalize-action="${request.id}">개인정보 파기 완료 처리</button></div>` : "";
  return `<article class="request-card">
    <div class="request-head"><div><h3>${escapeHtml(request.name || member.name || "회원")}</h3><p>${escapeHtml(request.memberNumber || member.memberNumber || "번호 없음")} · ${escapeHtml(request.email || member.email || "이메일 파기됨")}</p></div><span class="audit-chip">${escapeHtml(statusLabels[request.status] || request.status)}</span></div>
    <div class="request-meta"><span>요청 ${escapeHtml(formatTime(request.createdAt))}</span><span>계정 ${escapeHtml(memberStatus)}</span><span>${escapeHtml(disposalLabels[request.privacyDisposalStatus || "not_started"])}</span></div>
    <div class="request-reason"><b>탈퇴 사유</b><br>${escapeHtml(request.reason || "사유 미입력")}</div>
    ${reviewControls}${finalControls}
    <p class="privacy-note">일반 탈퇴는 블랙리스트가 아닙니다. 승인 시 ‘탈퇴 처리 중’으로 전환되고, 최종 파기 후 동일 이메일·연락처로 재가입할 수 있습니다.</p>
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
  const warning = nextStatus === "approved" ? "\n승인 즉시 회원 상태가 '탈퇴 처리 중'으로 바뀌며 로그인 이용이 중단됩니다. 블랙리스트에는 등록되지 않습니다." : "";
  if (!confirm(`${request.name || "회원"}의 탈퇴요청을 '${actionText}' 상태로 처리하시겠습니까?${warning}`)) return;
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
    if (nextStatus === "approved") batch.update(doc(db, "members", request.memberId), { status: "withdrawal_pending", accountDeletionStatus: "approved", updatedAt: serverTimestamp() });
    if (nextStatus === "rejected" && request.status === "approved" && member.status === "withdrawal_pending") batch.update(doc(db, "members", request.memberId), { status: request.previousMemberStatus || "active", accountDeletionStatus: "rejected", updatedAt: serverTimestamp() });
    const logRef = doc(collection(db, "accountChangeLogs"));
    batch.set(logRef, {
      memberId: request.memberId, memberNumber: request.memberNumber || member.memberNumber || "", memberName: request.name || member.name || "회원",
      actorUid: auth.currentUser.uid, actorEmail: auth.currentUser.email, actorType: "admin",
      eventType: `deletion_${nextStatus}`, changedFields: ["탈퇴요청 상태", ...(nextStatus === "approved" ? ["회원계정 상태", "개인정보 파기 상태"] : ["개인정보 파기 상태"])],
      before: { requestStatus: request.status || "requested", memberStatus: member.status || "unknown", privacyDisposalStatus: request.privacyDisposalStatus || "not_started" },
      after: { requestStatus: nextStatus, memberStatus: nextStatus === "approved" ? "withdrawal_pending" : member.status || "unknown", privacyDisposalStatus: nextDisposal },
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

async function finalizeWithdrawal(event) {
  const button = event.currentTarget;
  const request = requests.find(item => item.id === button.dataset.finalizeAction);
  const member = request ? membersById.get(request.memberId) : null;
  if (!request || !member) return;
  if (!$("#auth-deleted-" + request.id).checked) {
    $("#requestMessage").textContent = "먼저 Firebase Authentication 계정 삭제 완료 확인란을 선택해 주세요.";
    return;
  }
  if (!confirm(`${request.name || "회원"}의 개인정보를 최종 파기하시겠습니까?\n이 작업은 되돌릴 수 없으며, 처리 후 동일 이메일·연락처 재가입이 허용됩니다.`)) return;
  button.disabled = true;
  $("#requestMessage").textContent = "개인정보와 연락처 중복잠금을 파기하고 있습니다.";
  try {
    const [addressSnapshot, logSnapshot] = await Promise.all([
      getDocs(query(collection(db, "memberAddresses"), where("memberId", "==", member.id))),
      getDocs(query(collection(db, "accountChangeLogs"), where("memberId", "==", member.id)))
    ]);
    if (addressSnapshot.size + logSnapshot.size > 450) throw new Error("파기 대상 기록이 많아 분할 처리가 필요합니다.");
    const batch = writeBatch(db);
    const emailKey = member.email ? await emailBlockKey(member.email) : "";
    addressSnapshot.forEach(item => batch.delete(item.ref));
    batch.delete(doc(db, "memberProfiles", member.id));
    batch.delete(doc(db, "memberRestrictions", member.id));
    if (member.phoneKey) batch.delete(doc(db, "memberPhones", member.phoneKey));
    if (emailKey) batch.delete(doc(db, "memberEmailBlocks", emailKey));
    logSnapshot.forEach(item => {
      const data = item.data();
      batch.update(item.ref, {
        memberName: "탈퇴회원",
        actorEmail: data.actorType === "member" ? "" : data.actorEmail || "",
        before: { privacy: "개인정보 파기됨" },
        after: { privacy: "개인정보 파기됨" },
        description: "개인정보 파기 후 감사유형·처리시각만 보존"
      });
    });
    batch.update(doc(db, "members", member.id), {
      name: "탈퇴회원", phone: "", phoneKey: "", email: "", birthDate: "", gender: "", region: "", benefit: "", hasPet: "",
      referrer: "", referralCode: "", centerName: "", centerCode: "", partnerName: deleteField(), partnerId: deleteField(), authUid: deleteField(),
      agreePrivacy: false, agreeMarketing: false, agreeThirdParty: false, status: "withdrawn", accountDeletionStatus: "completed", adminMemo: "탈퇴 개인정보 파기 완료",
      withdrawnAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    batch.update(doc(db, "accountDeletionRequests", request.id), {
      name: "탈퇴회원", email: "", reason: "개인정보 파기 완료", status: "completed", privacyDisposalStatus: "completed",
      adminMemo: "Firebase Authentication 삭제 확인 후 개인정보 파기 완료", reviewedBy: auth.currentUser.email,
      reviewedAt: serverTimestamp(), completedAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    const logRef = doc(collection(db, "accountChangeLogs"));
    batch.set(logRef, {
      memberId: member.id, memberNumber: member.memberNumber || "", memberName: "탈퇴회원",
      actorUid: auth.currentUser.uid, actorEmail: auth.currentUser.email, actorType: "admin", eventType: "deletion_completed",
      changedFields: ["개인정보", "연락처 중복잠금", "회원계정 상태"],
      before: { requestStatus: "approved", memberStatus: member.status || "withdrawal_pending", privacyDisposalStatus: "scheduled" },
      after: { requestStatus: "completed", memberStatus: "withdrawn", privacyDisposalStatus: "completed", rejoinAllowed: true },
      description: "Firebase Authentication 삭제 확인 후 개인정보 파기 완료", createdAt: serverTimestamp()
    });
    await batch.commit();
    $("#requestMessage").textContent = "탈퇴 개인정보 파기를 완료했습니다. 동일 이메일·연락처로 재가입할 수 있습니다.";
    await loadAll();
  } catch (error) {
    console.error(error);
    $("#requestMessage").textContent = error.message || "최종 파기를 완료하지 못했습니다.";
    button.disabled = false;
  }
}

function renderRestrictions() {
  const word = $("#restrictionSearch").value.trim().toLowerCase();
  const filter = $("#restrictionStatus").value;
  const members = [...membersById.values()].filter(member => {
    if (["withdrawal_pending", "withdrawn"].includes(member.status)) return false;
    const restriction = restrictionsById.get(member.id) || {};
    const effective = restriction.active ? restriction.level : member.status === "blocked" ? "blacklist" : member.status === "paused" ? "paused" : "none";
    const searchable = [member.name, member.memberNumber, member.email, member.phone, restriction.reason].join(" ").toLowerCase();
    const visibleByDefault = word || filter === "all" || effective !== "none";
    return visibleByDefault && (!filter || filter === "all" || effective === filter) && (!word || searchable.includes(word));
  });
  $("#restrictionList").innerHTML = members.length ? members.map(restrictionCard).join("") : '<div class="role-empty">검색어를 입력해 회원을 찾거나 등록된 주의·차단회원을 확인하세요.</div>';
  document.querySelectorAll("[data-restriction-action]").forEach(button => button.addEventListener("click", saveRestriction));
}

function restrictionCard(member) {
  const restriction = restrictionsById.get(member.id) || {};
  const level = restriction.active ? restriction.level : member.status === "blocked" ? "blacklist" : member.status === "paused" ? "paused" : "none";
  const options = Object.entries(restrictionLabels).map(([value, label]) => `<option value="${value}" ${level === value ? "selected" : ""}>${label}</option>`).join("");
  return `<article class="request-card restriction-card">
    <div class="request-head"><div><h3>${escapeHtml(member.name || "회원")}</h3><p>${escapeHtml(member.memberNumber || "번호 없음")} · ${escapeHtml(member.email || "이메일 없음")} · ${escapeHtml(member.phone || "연락처 없음")}</p></div><span class="audit-chip">${escapeHtml(restrictionLabels[level] || level)}</span></div>
    <div class="request-controls"><label>관리 구분<select id="restriction-level-${member.id}">${options}</select></label><label>지정·해제 사유<textarea id="restriction-reason-${member.id}" maxlength="1000" placeholder="민원·운영 근거를 구체적으로 기록하세요.">${escapeHtml(restriction.reason || "")}</textarea></label></div>
    <div class="request-actions"><button class="account-action ${level === "blacklist" ? "danger" : "primary"}" type="button" data-restriction-action="${member.id}">관리 상태 저장</button></div>
    <p class="privacy-note">주의회원은 로그인 가능, 일시 정지는 로그인 제한, 블랙리스트는 로그인과 동일 연락처 재가입을 차단합니다. 일반 탈퇴회원과는 별도 관리됩니다.</p>
  </article>`;
}

async function saveRestriction(event) {
  const button = event.currentTarget;
  const member = membersById.get(button.dataset.restrictionAction);
  if (!member) return;
  const level = $("#restriction-level-" + member.id).value;
  const reason = $("#restriction-reason-" + member.id).value.trim();
  if (!reason) { $("#restrictionMessage").textContent = "주의·차단 지정 또는 해제 사유를 입력해 주세요."; return; }
  const current = restrictionsById.get(member.id) || {};
  const currentLevel = current.active ? current.level : member.status === "blocked" ? "blacklist" : member.status === "paused" ? "paused" : "none";
  if (!confirm(`${member.name || "회원"}을(를) '${restrictionLabels[level]}' 상태로 저장하시겠습니까?`)) return;
  button.disabled = true;
  $("#restrictionMessage").textContent = "회원 관리상태와 감사기록을 저장하고 있습니다.";
  try {
    const batch = writeBatch(db);
    const nextStatus = level === "blacklist" ? "blocked" : level === "paused" ? "paused" : "active";
    const emailKey = member.email ? await emailBlockKey(member.email) : "";
    batch.update(doc(db, "members", member.id), { status: nextStatus, restrictionLevel: level, updatedAt: serverTimestamp() });
    batch.set(doc(db, "memberRestrictions", member.id), {
      memberId: member.id, memberNumber: member.memberNumber || "", memberName: member.name || "회원", memberEmail: member.email || "", memberPhoneKey: member.phoneKey || "",
      level, accessStatus: nextStatus, active: level !== "none", reason, createdAt: current.createdAt || serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: auth.currentUser.email
    }, { merge: true });
    if (emailKey && level === "blacklist") {
      batch.set(doc(db, "memberEmailBlocks", emailKey), { memberId: member.id, memberNumber: member.memberNumber || "", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else if (emailKey) {
      batch.delete(doc(db, "memberEmailBlocks", emailKey));
    }
    const eventType = level === "none" ? "restriction_released" : level === "watchlist" ? "restriction_watchlist" : level === "paused" ? "restriction_paused" : "restriction_blacklisted";
    batch.set(doc(collection(db, "accountChangeLogs")), {
      memberId: member.id, memberNumber: member.memberNumber || "", memberName: member.name || "회원",
      actorUid: auth.currentUser.uid, actorEmail: auth.currentUser.email, actorType: "admin", eventType,
      changedFields: ["회원 관리구분", "회원계정 상태"], before: { restriction: currentLevel, memberStatus: member.status || "active" },
      after: { restriction: level, memberStatus: nextStatus }, description: reason, createdAt: serverTimestamp()
    });
    await batch.commit();
    $("#restrictionMessage").textContent = `${member.name || "회원"}을(를) ${restrictionLabels[level]} 상태로 저장했습니다.`;
    await loadAll();
  } catch (error) {
    console.error(error);
    $("#restrictionMessage").textContent = "회원 관리상태를 저장하지 못했습니다. 관리자 권한을 확인해 주세요.";
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
  const actor = log.actorType === "admin" ? ADMIN_NAME : "회원 본인";
  return `<article class="audit-item"><div class="audit-time">${escapeHtml(formatTime(log.createdAt))}</div><div class="audit-main"><h3>${escapeHtml(log.memberName || "회원")} · ${escapeHtml(log.memberNumber || "번호 없음")}</h3><p><span class="audit-chip">${escapeHtml(eventLabels[log.eventType] || log.eventType)}</span> ${escapeHtml((log.changedFields || []).join(", "))}</p><p>처리자: ${escapeHtml(actor)}</p>${log.description ? `<p>${escapeHtml(log.description)}</p>` : ""}<div class="audit-values"><b>변경 전</b> ${escapeHtml(compactValue(log.before))}<br><b>변경 후</b> ${escapeHtml(compactValue(log.after))}</div></div></article>`;
}
