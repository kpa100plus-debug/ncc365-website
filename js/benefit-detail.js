import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";
import { benefitMap } from "./benefit-catalog.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = selector => document.querySelector(selector);
const id = new URLSearchParams(location.search).get("id") || "first-health";
const offer = benefitMap[id] || benefitMap["first-health"];
const form = $("#benefitApplicationForm");
const submitButton = form.querySelector('button[type="submit"]');

let currentUser = null;
let currentMember = null;
let authResolved = false;

document.title = `${offer.title} | 전국소비자클럽`;
$("#crumbTitle").textContent = offer.title;
$("#detailStatus").textContent = offer.status;
$("#detailCategory").textContent = offer.category;
$("#detailTitle").textContent = offer.title;
$("#detailLead").textContent = offer.lead;
$("#detailTarget").textContent = offer.target;
$("#detailArea").textContent = offer.area;
$("#detailPeriod").textContent = offer.condition;
$("#detailVisual").innerHTML = `<img src="${offer.image}" alt="${offer.title}">`;
$("#pointGrid").innerHTML = offer.points.map((value, index) => `<div><span>0${index + 1}</span><b>${value}</b></div>`).join("");
$("#stepList").innerHTML = offer.steps.map(value => `<li>${value}</li>`).join("");
$("#appType").innerHTML = offer.types.map(value => `<option>${value}</option>`).join("");
$("#formTitle").textContent = `${offer.title} 신청`;

function regionValue(value, targetForm) {
  const regions = [...targetForm.elements.region.options].map(option => option.value).filter(Boolean);
  return regions.find(region => String(value || "").includes(region)) || "";
}

function storedMember(user) {
  try {
    const saved = JSON.parse(sessionStorage.getItem("nccMemberProfile") || "null");
    if (!saved?.id) return null;
    if (saved.email && user.email && saved.email.toLowerCase() !== user.email.toLowerCase()) return null;
    return saved;
  } catch {
    return null;
  }
}

async function findMember(user) {
  const saved = storedMember(user);
  if (saved?.id) {
    try {
      const snapshot = await getDoc(doc(db, "members", saved.id));
      if (snapshot.exists()) return { id: snapshot.id, ...saved, ...snapshot.data() };
    } catch (error) {
      console.warn("월렛 회원문서 직접 복원 실패, 보조 조회를 계속합니다.", error);
    }
  }

  let snapshot = await getDocs(query(collection(db, "members"), where("authUid", "==", user.uid), limit(1)));
  if (snapshot.empty && user.email) {
    snapshot = await getDocs(query(collection(db, "members"), where("email", "==", user.email), limit(1)));
  }
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function selectedType() {
  return form.elements.type.value;
}

function updateSubmitLabel() {
  if (!authResolved) {
    submitButton.textContent = "회원정보 확인 중...";
    return;
  }
  submitButton.textContent = selectedType() === "모집 알림 신청" ? "모집 알림 신청" : "혜택 신청 접수";
}

function setFormReady(ready) {
  submitButton.disabled = !ready;
  form.setAttribute("aria-busy", String(!authResolved));
  updateSubmitLabel();
}

function fillMember(targetForm) {
  if (!currentMember) return;
  targetForm.elements.name.value = currentMember.name || "";
  targetForm.elements.phone.value = currentMember.phone || "";
  targetForm.elements.region.value = regionValue(currentMember.region, targetForm);
  targetForm.elements.name.readOnly = true;
  targetForm.elements.phone.readOnly = true;
}

function showLoginRequired() {
  const sideAction = $("#memberSideAction");
  $("#memberSideGuide").textContent = "NCC 월렛에 로그인한 회원만 신청할 수 있습니다.";
  sideAction.hidden = false;
  sideAction.textContent = "NCC 월렛 로그인";
  sideAction.href = "wallet.html";
  $("#formMessage").innerHTML = '신청하려면 <a href="wallet.html">NCC 월렛에 먼저 로그인</a>해 주세요.';
  setFormReady(false);
}

setFormReady(false);
$("#formMessage").textContent = "로그인과 NCC 회원정보를 확인하고 있습니다.";

onAuthStateChanged(auth, async user => {
  currentUser = user;
  currentMember = null;
  authResolved = true;

  if (!user || (!user.emailVerified && user.email?.toLowerCase() !== "kpa100plus@gmail.com")) {
    showLoginRequired();
    return;
  }

  try {
    currentMember = await findMember(user);
    if (!currentMember) {
      $("#formMessage").innerHTML = '로그인 계정과 연결된 NCC 회원정보를 찾지 못했습니다. <a href="wallet.html">월렛에서 회원정보를 확인</a>해 주세요.';
      $("#memberSideGuide").textContent = "로그인 계정과 NCC 회원정보 연결을 확인해 주세요.";
      const action = $("#memberSideAction");
      action.hidden = false;
      action.textContent = "회원정보 확인";
      action.href = "wallet.html";
      setFormReady(false);
      return;
    }

    fillMember(form);
    $("#formMessage").textContent = `NCC 회원 ${currentMember.memberNumber || ""} 정보가 확인되었습니다.`;
    $("#memberSideGuide").textContent = "확인된 NCC 회원정보로 바로 신청할 수 있습니다.";
    const action = $("#memberSideAction");
    action.hidden = false;
    action.textContent = "혜택 신청하기";
    action.href = "#application";
    setFormReady(true);
  } catch (error) {
    console.error(error);
    $("#formMessage").textContent = "회원정보 확인 중 통신 오류가 발생했습니다. 페이지를 새로고침해 주세요.";
    setFormReady(false);
  }
});

form.elements.type.addEventListener("change", updateSubmitLabel);

form.addEventListener("submit", async event => {
  event.preventDefault();
  const targetForm = event.currentTarget;
  const button = targetForm.querySelector('button[type="submit"]');
  const message = $("#formMessage");
  const data = Object.fromEntries(new FormData(targetForm));

  if (!authResolved) {
    message.textContent = "로그인 확인이 끝날 때까지 잠시만 기다려 주세요.";
    return;
  }
  if (!currentUser || !currentMember) {
    message.innerHTML = '로그인 상태를 확인할 수 없습니다. <a href="wallet.html">NCC 월렛에서 다시 확인</a>해 주세요.';
    return;
  }

  const isAlert = data.type === "모집 알림 신청";
  const receipt = `NCC-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
  const record = {
    ...data,
    message: String(data.message || ""),
    memberId: currentMember.id,
    memberEmail: currentUser.email,
    offerId: id,
    offerTitle: offer.title,
    receipt,
    status: "new",
    source: "website"
  };

  button.disabled = true;
  button.textContent = isAlert ? "알림 신청 중..." : "신청 접수 중...";
  message.textContent = "";

  try {
    const ownApplications = await getDocs(query(collection(db, "benefitApplications"), where("memberId", "==", currentMember.id), limit(100)));
    const duplicate = ownApplications.docs.some(item => {
      const saved = item.data();
      return saved.offerId === id && saved.type === data.type;
    });
    if (duplicate) {
      message.innerHTML = isAlert
        ? '이미 모집 알림을 신청한 혜택입니다. <a href="wallet.html#activity">NCC 월렛 알림·신청내역 보기</a>'
        : '이미 신청한 혜택입니다. <a href="wallet.html#activity">NCC 월렛에서 진행상태 보기</a>';
      return;
    }

    await addDoc(collection(db, "benefitApplications"), {
      ...record,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    targetForm.hidden = true;
    $("#receiptNo").textContent = receipt;
    $("#successTitle").textContent = isAlert ? "모집 알림 신청이 완료되었습니다" : "혜택 신청이 정상 접수되었습니다";
    $("#successGuide").textContent = isAlert
      ? "NCC 월렛 신청내역에 저장되었습니다. 관리자가 모집 시작을 승인하면 월렛 알림함에 안내가 표시됩니다."
      : "NCC 월렛에서 신청내역과 진행상태를 확인할 수 있습니다.";
    $("#successBox").hidden = false;
    $("#successBox").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    console.error(error);
    const code = String(error?.code || "");
    message.textContent = code.includes("permission-denied")
      ? "회원 인증 또는 신청 저장 권한을 확인하지 못했습니다. NCC 월렛에서 다시 로그인해 주세요."
      : code.includes("unavailable")
        ? "통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요."
        : "신청 처리 중 오류가 발생했습니다. 입력내용은 유지되므로 다시 시도해 주세요.";
  } finally {
    setFormReady(Boolean(currentUser && currentMember));
  }
});

$("#newApplication").addEventListener("click", () => {
  form.reset();
  fillMember(form);
  form.hidden = false;
  $("#successBox").hidden = true;
  $("#formMessage").textContent = currentMember ? `NCC 회원 ${currentMember.memberNumber || ""} 정보가 확인되었습니다.` : "";
  updateSubmitLabel();
});
