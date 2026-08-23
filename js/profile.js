import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = selector => document.querySelector(selector);

let currentUser = null;
let member = null;
let profile = {};
let addresses = [];

const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const phoneKey = value => String(value || "").replace(/\D/g, "");

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user || !user.emailVerified) {
    location.href = "wallet.html?next=profile.html";
    return;
  }
  try {
    member = await findMember(user);
    if (!member) throw new Error("회원정보를 찾을 수 없습니다.");
    if (["paused", "blocked"].includes(member.status || "active")) {
      throw new Error("현재 이용이 제한된 회원계정입니다. 본사 관리자에게 문의해 주세요.");
    }
    await syncVerifiedEmail(user);
    await loadProfile();
    await loadAddresses();
    fillBasicForm();
    $("#profileStatus").hidden = true;
    for (const selector of ["#basicForm", "#profileForm", "#addressSection", "#securitySection", "#withdrawSection"]) {
      $(selector).hidden = false;
    }
  } catch (error) {
    console.error(error);
    $("#profileStatus").textContent = error.message || "회원정보를 불러오지 못했습니다.";
  }
});

async function findMember(user) {
  let snapshot = await getDocs(query(collection(db, "members"), where("authUid", "==", user.uid), limit(1)));
  if (snapshot.empty) snapshot = await getDocs(query(collection(db, "members"), where("email", "==", user.email), limit(1)));
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function syncVerifiedEmail(user) {
  if (!member.authUid || member.authUid !== user.uid || !user.email || member.email === user.email) return;
  const memberRef = doc(db, "members", member.id);
  const profileRef = doc(db, "memberProfiles", member.id);
  const logRef = doc(collection(db, "accountChangeLogs"));
  const previousEmail = member.email || "";
  await runTransaction(db, async transaction => {
    const profileSnapshot = await transaction.get(profileRef);
    transaction.update(memberRef, { email: user.email, updatedAt: serverTimestamp() });
    if (profileSnapshot.exists()) transaction.update(profileRef, { email: user.email, updatedAt: serverTimestamp() });
    transaction.set(logRef, accountLog("email_synced", ["이메일"], { email: previousEmail }, { email: user.email }, "이메일 변경 인증 완료"));
  });
  member.email = user.email;
}

function accountLog(eventType, changedFields, before, after, description = "") {
  return {
    memberId: member.id,
    memberNumber: member.memberNumber || "",
    memberName: member.name || "회원",
    actorUid: currentUser.uid,
    actorEmail: currentUser.email,
    actorType: "member",
    eventType,
    changedFields,
    before,
    after,
    description,
    createdAt: serverTimestamp()
  };
}

function fillBasicForm() {
  const form = $("#basicForm");
  form.elements.name.value = member.name || "";
  form.elements.phone.value = member.phone || "";
  form.elements.region.value = member.region || "";
  form.elements.email.value = currentUser.email || member.email || "";
}

$("#basicForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const nextName = data.name.trim();
  const nextPhone = data.phone.trim();
  const nextPhoneKey = phoneKey(nextPhone);
  const nextRegion = data.region.trim();
  const message = $("#basicMessage");
  if (!nextName || !nextRegion || !/^[0-9]{9,11}$/.test(nextPhoneKey)) {
    message.textContent = "이름·지역과 9~11자리 연락처를 정확히 입력해 주세요.";
    return;
  }
  message.textContent = "저장 중입니다.";
  try {
    const memberRef = doc(db, "members", member.id);
    const profileRef = doc(db, "memberProfiles", member.id);
    const logRef = doc(collection(db, "accountChangeLogs"));
    const oldPhoneKey = member.phoneKey || phoneKey(member.phone);
    const phoneChanged = oldPhoneKey !== nextPhoneKey;
    const before = { name: member.name || "", phone: member.phone || "", region: member.region || "" };
    const after = { name: nextName, phone: nextPhone, region: nextRegion };
    const changedFields = Object.keys(after).filter(key => before[key] !== after[key]).map(key => ({ name: "이름", phone: "연락처", region: "지역" }[key]));
    if (!changedFields.length) { message.textContent = "변경된 기본정보가 없습니다."; return; }
    await runTransaction(db, async transaction => {
      const memberSnapshot = await transaction.get(memberRef);
      if (!memberSnapshot.exists()) throw new Error("회원정보를 찾을 수 없습니다.");
      const profileSnapshot = await transaction.get(profileRef);
      let nextPhoneLock = null;
      let nextPhoneLockExists = false;
      if (phoneChanged) {
        nextPhoneLock = doc(db, "memberPhones", nextPhoneKey);
        const lockSnapshot = await transaction.get(nextPhoneLock);
        if (lockSnapshot.exists() && lockSnapshot.data().memberId !== member.id) throw new Error("이미 다른 회원이 사용 중인 연락처입니다.");
        nextPhoneLockExists = lockSnapshot.exists();
      }
      transaction.update(memberRef, { name: nextName, phone: nextPhone, phoneKey: nextPhoneKey, region: nextRegion, updatedAt: serverTimestamp() });
      if (profileSnapshot.exists()) transaction.update(profileRef, { phoneKey: nextPhoneKey, updatedAt: serverTimestamp() });
      if (phoneChanged && nextPhoneLock && !nextPhoneLockExists) {
        transaction.set(nextPhoneLock, { memberId: member.id, memberNumber: member.memberNumber, createdAt: serverTimestamp() });
      }
      if (phoneChanged && oldPhoneKey) transaction.delete(doc(db, "memberPhones", oldPhoneKey));
      transaction.set(logRef, accountLog("basic_profile_updated", changedFields, before, after, "회원 본인 기본정보 변경"));
    });
    member = { ...member, name: nextName, phone: nextPhone, phoneKey: nextPhoneKey, region: nextRegion };
    sessionStorage.setItem("nccMemberProfile", JSON.stringify({ id: member.id, name: member.name, phone: member.phone, region: member.region, email: member.email, memberNumber: member.memberNumber, memberType: member.memberType || "consumer" }));
    message.textContent = "기본정보가 저장되었습니다.";
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "기본정보를 저장하지 못했습니다.";
  }
});

async function loadProfile() {
  const snapshot = await getDoc(doc(db, "memberProfiles", member.id));
  profile = snapshot.exists() ? snapshot.data() : {};
  const form = $("#profileForm");
  const additional = profile.additional || {};
  const special = profile.special || {};
  const consumer = profile.consumer || {};
  const values = {
    job: additional.job, maritalStatus: additional.maritalStatus, familyComposition: additional.familyComposition,
    interests: (additional.interests || []).join(", "), preferredProducts: additional.preferredProducts,
    preferredServices: additional.preferredServices, preferredPriceRange: additional.preferredPriceRange,
    petType: special.petType, hasVehicle: special.hasVehicle, housingType: special.housingType,
    healthInterests: special.healthInterests, travelInterests: special.travelInterests,
    lifeServiceInterests: special.lifeServiceInterests, frequentPurchases: consumer.frequentPurchases,
    onlineMalls: consumer.onlineMalls, monthlySpendRange: consumer.monthlySpendRange,
    purchaseMethod: consumer.purchaseMethod, experienceInterests: consumer.experienceInterests,
    reviewAvailable: consumer.reviewAvailable
  };
  Object.entries(values).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ""; });
  form.elements.agreeProfileUse.checked = Boolean(special.agreeProfileUse);
}

$("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  profile = {
    ...profile, memberId: member.id, memberNumber: member.memberNumber, email: member.email,
    phoneKey: member.phoneKey || phoneKey(member.phone), profileVersion: 1,
    additional: { ...(profile.additional || {}), job: data.job.trim(), maritalStatus: data.maritalStatus, familyComposition: data.familyComposition.trim(), interests: data.interests.split(",").map(value => value.trim()).filter(Boolean), preferredProducts: data.preferredProducts.trim(), preferredServices: data.preferredServices.trim(), preferredPriceRange: data.preferredPriceRange },
    special: { ...(profile.special || {}), petType: data.petType.trim(), hasVehicle: data.hasVehicle, housingType: data.housingType, healthInterests: data.healthInterests.trim(), travelInterests: data.travelInterests.trim(), lifeServiceInterests: data.lifeServiceInterests.trim(), agreeProfileUse: form.elements.agreeProfileUse.checked },
    consumer: { ...(profile.consumer || {}), frequentPurchases: data.frequentPurchases.trim(), onlineMalls: data.onlineMalls.trim(), monthlySpendRange: data.monthlySpendRange, purchaseMethod: data.purchaseMethod, experienceInterests: data.experienceInterests.trim(), reviewAvailable: data.reviewAvailable },
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "memberProfiles", member.id), profile, { merge: true });
    $("#profileMessage").textContent = "맞춤정보가 저장되었습니다.";
  } catch (error) {
    console.error(error);
    $("#profileMessage").textContent = "저장하지 못했습니다. 권한을 확인해 주세요.";
  }
});

async function loadAddresses() {
  const snapshot = await getDocs(query(collection(db, "memberAddresses"), where("memberId", "==", member.id)));
  addresses = snapshot.docs.map(addressDocument => ({ id: addressDocument.id, ...addressDocument.data() }));
  if (!addresses.length && profile.basic?.address) {
    await addDoc(collection(db, "memberAddresses"), { memberId: member.id, label: "가입 주소", recipient: profile.basic.recipientName || member.name || "NCC 회원", phone: member.phone || "", postalCode: profile.basic.postalCode || "", address: profile.basic.address, addressDetail: profile.basic.addressDetail || "", isDefault: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return loadAddresses();
  }
  renderAddresses();
}

function renderAddresses() {
  const list = $("#addressList");
  list.innerHTML = addresses.length ? addresses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(address => `
    <article class="address-card"><div><h3>${safe(address.label || "배송지")}${address.isDefault ? '<span class="default-chip">기본</span>' : ""}</h3><p>${safe(address.recipient)} · ${safe(address.phone)}</p><p>${safe(address.postalCode)} ${safe(address.address)} ${safe(address.addressDetail)}</p></div><div class="address-actions"><button class="mini-button" type="button" data-edit="${address.id}">수정</button><button class="mini-button" type="button" data-delete="${address.id}">삭제</button></div></article>`).join("") : '<div class="empty-state">저장된 배송지가 없습니다.</div>';
  list.querySelectorAll("[data-edit]").forEach(button => button.addEventListener("click", () => editAddress(button.dataset.edit)));
  list.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", () => removeAddress(button.dataset.delete)));
}

$("#addAddress").addEventListener("click", () => openAddress());
$("#cancelAddress").addEventListener("click", () => { $("#addressForm").hidden = true; $("#addressMessage").textContent = ""; });

function openAddress(address = {}) {
  const form = $("#addressForm");
  form.reset();
  form.elements.addressId.value = address.id || "";
  for (const key of ["label", "recipient", "phone", "postalCode", "address", "addressDetail"]) {
    form.elements[key].value = address[key] || ((key === "recipient" && member.name) || (key === "phone" && member.phone) || "");
  }
  form.elements.isDefault.checked = Boolean(address.isDefault) || !addresses.length;
  $("#addressMessage").textContent = "";
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function editAddress(id) { openAddress(addresses.find(address => address.id === id) || {}); }

$("#searchAddress").addEventListener("click", () => {
  const message = $("#addressMessage");
  if (!window.daum?.Postcode) {
    message.textContent = "주소검색을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return;
  }
  new window.daum.Postcode({ oncomplete(data) {
    const form = $("#addressForm");
    form.elements.postalCode.value = data.zonecode || "";
    form.elements.address.value = data.roadAddress || data.jibunAddress || "";
    form.elements.addressDetail.focus();
    message.textContent = "주소가 입력되었습니다. 상세주소를 확인해 주세요.";
  } }).open();
});

$("#addressForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const id = data.addressId;
  const payload = { memberId: member.id, label: data.label.trim(), recipient: data.recipient.trim(), phone: data.phone.trim(), postalCode: data.postalCode.trim(), address: data.address.trim(), addressDetail: data.addressDetail.trim(), isDefault: form.elements.isDefault.checked, updatedAt: serverTimestamp() };
  try {
    if (payload.isDefault) await Promise.all(addresses.filter(address => address.isDefault && address.id !== id).map(address => updateDoc(doc(db, "memberAddresses", address.id), { isDefault: false, updatedAt: serverTimestamp() })));
    if (id) await updateDoc(doc(db, "memberAddresses", id), payload);
    else await addDoc(collection(db, "memberAddresses"), { ...payload, createdAt: serverTimestamp() });
    form.hidden = true;
    await loadAddresses();
  } catch (error) {
    console.error(error);
    $("#addressMessage").textContent = "배송지를 저장하지 못했습니다. 권한을 확인해 주세요.";
  }
});

async function removeAddress(id) {
  if (!confirm("이 배송지를 삭제하시겠습니까?")) return;
  try { await deleteDoc(doc(db, "memberAddresses", id)); await loadAddresses(); }
  catch (error) { console.error(error); alert("배송지를 삭제하지 못했습니다."); }
}

$("#sendPasswordReset").addEventListener("click", async () => {
  const message = $("#passwordMessage");
  message.textContent = "발송 중입니다.";
  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    try {
      await addDoc(collection(db, "accountChangeLogs"), accountLog("password_reset_requested", ["비밀번호"], { status: "기존 비밀번호 유지" }, { status: "재설정 메일 발송" }, "회원 본인 요청"));
    } catch (logError) { console.error("비밀번호 재설정 로그 저장 실패", logError); }
    message.textContent = `${currentUser.email}로 비밀번호 재설정 메일을 보냈습니다.`;
  } catch (error) {
    console.error(error);
    message.textContent = "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
});

$("#emailChangeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const nextEmail = data.newEmail.trim().toLowerCase();
  const message = $("#emailMessage");
  if (nextEmail === currentUser.email?.toLowerCase()) { message.textContent = "현재 이메일과 다른 이메일을 입력해 주세요."; return; }
  message.textContent = "인증메일을 준비하고 있습니다.";
  try {
    const credential = EmailAuthProvider.credential(currentUser.email, data.currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await verifyBeforeUpdateEmail(currentUser, nextEmail);
    try {
      await addDoc(collection(db, "accountChangeLogs"), accountLog("email_change_requested", ["이메일"], { email: currentUser.email }, { email: nextEmail }, "새 이메일 인증 대기"));
    } catch (logError) { console.error("이메일 변경 로그 저장 실패", logError); }
    form.elements.currentPassword.value = "";
    message.textContent = `${nextEmail}로 변경 인증메일을 보냈습니다. 인증 링크를 누른 뒤 다시 로그인해 주세요.`;
  } catch (error) {
    console.error(error);
    if (error.code === "auth/email-already-in-use") message.textContent = "이미 사용 중인 이메일입니다.";
    else if (["auth/invalid-credential", "auth/wrong-password"].includes(error.code)) message.textContent = "현재 비밀번호가 맞지 않습니다.";
    else message.textContent = "이메일 변경 인증메일을 보내지 못했습니다.";
  }
});

$("#withdrawForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const message = $("#withdrawMessage");
  if (!form.elements.confirm.checked) { message.textContent = "탈퇴 안내 확인에 동의해 주세요."; return; }
  if (!confirm("회원탈퇴를 요청하시겠습니까? 본사 확인 전까지 계정은 유지됩니다.")) return;
  message.textContent = "탈퇴 요청을 접수하고 있습니다.";
  const requestRef = doc(db, "accountDeletionRequests", member.id);
  const logRef = doc(collection(db, "accountChangeLogs"));
  try {
    await runTransaction(db, async transaction => {
      const existing = await transaction.get(requestRef);
      const payload = { memberId: member.id, memberNumber: member.memberNumber, name: member.name, email: currentUser.email, reason: data.reason.trim(), status: "requested", privacyDisposalStatus: "not_started", adminMemo: "", reviewedBy: "", reviewedAt: null, updatedAt: serverTimestamp() };
      if (existing.exists()) transaction.update(requestRef, payload);
      else transaction.set(requestRef, { ...payload, createdAt: serverTimestamp() });
      transaction.set(logRef, accountLog("deletion_requested", ["탈퇴요청 상태"], { status: existing.exists() ? existing.data().status : "없음" }, { status: "requested" }, data.reason.trim() || "사유 미입력"));
    });
    form.elements.reason.value = "";
    form.elements.confirm.checked = false;
    message.textContent = "회원탈퇴 요청이 접수되었습니다. 본사 확인 후 처리됩니다.";
  } catch (error) {
    console.error(error);
    message.textContent = "회원탈퇴 요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
});
