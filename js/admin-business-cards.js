import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAIL = "kpa100plus@gmail.com";
const MEMBER_NUMBER_PATTERN = /^NCC-C-[0-9]{6}$/;
const CENTER_ROLES = ["center_manager", "center_staff"];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const form = $("#cardForm");
const message = $("#formMessage");
const exportMessage = $("#exportMessage");

let verifiedMemberNumber = "";
let verifiedMemberId = "";
let exporting = false;
let lookupMode = "memberNumber";
let verifiedCenterCode = "";

const roleEnglish = {
  "센터장": "NCC CENTER DIRECTOR",
  "운영팀장": "NCC OPERATIONS LEAD",
  "회원지원팀장": "NCC MEMBER SUPPORT LEAD",
  "지역협력매니저": "NCC COMMUNITY PARTNERSHIP MANAGER",
  "센터 팀원": "NCC CENTER STAFF"
};

function normalizeMemberNumber(value) {
  return String(value || "").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
}

function normalizeCenterCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "-");
}

function setOutput(key, value) {
  $$(`[data-output="${key}"]`).forEach(node => node.textContent = value || "미입력");
}

function renderQr(memberNumber) {
  const url = `${location.origin}/certificate-verify.html?id=${encodeURIComponent(memberNumber)}`;
  const target = $("#cardQr");
  target.replaceChildren();
  if (typeof window.qrcode === "function") {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } else {
    target.textContent = "QR 생성 실패";
  }
  const link = $("#verificationLink");
  link.href = url;
  link.textContent = `QR 연결 확인 · ${memberNumber}`;
}

function values() {
  const data = Object.fromEntries(new FormData(form));
  data.memberNumber = normalizeMemberNumber(data.memberNumber);
  data.centerCode = normalizeCenterCode(data.centerCode);
  return data;
}

function exportReady() {
  const data = values();
  return Boolean(
    verifiedMemberId &&
    verifiedMemberNumber === data.memberNumber &&
    verifiedCenterCode === data.centerCode &&
    form.checkValidity()
  );
}

function updateExportState() {
  $$('[data-export]').forEach(button => button.disabled = exporting || !exportReady());
}

function invalidateVerification(text = "회원번호를 다시 조회해야 인쇄용 JPG를 내보낼 수 있습니다.") {
  verifiedMemberNumber = "";
  verifiedCenterCode = "";
  verifiedMemberId = "";
  exportMessage.textContent = text;
  updateExportState();
}

function render({ quiet = false } = {}) {
  const data = values();
  if (!form.reportValidity()) return false;
  if (!MEMBER_NUMBER_PATTERN.test(data.memberNumber)) {
    message.textContent = "회원번호는 NCC-C-000001 형식의 실제 발급번호를 입력해 주세요.";
    form.elements.memberNumber.focus();
    return false;
  }
  if (!data.centerCode || data.centerCode.length > 100) {
    message.textContent = "센터코드는 현재 시스템에 저장된 100자 이하 코드를 입력해 주세요.";
    form.elements.centerCode.focus();
    return false;
  }

  form.elements.memberNumber.value = data.memberNumber;
  form.elements.centerCode.value = data.centerCode;
  setOutput("name", data.name.trim());
  setOutput("centerRole", `${data.centerName.trim()} ${data.role}`);
  setOutput("roleEnglish", roleEnglish[data.role] || "NCC CENTER STAFF");
  setOutput("phone", data.phone.trim());
  setOutput("email", data.email.trim());
  setOutput("address", data.address.trim() || "주소 미등록");
  setOutput("centerCode", data.centerCode);
  setOutput("memberNumber", data.memberNumber);
  const preview = $("#previewSet");
  preview.classList.remove("portrait");
  preview.classList.add("landscape");
  renderQr(data.memberNumber);
  if (!quiet) {
    message.textContent = exportReady()
      ? "확인된 실제 센터 회원정보로 명함 시안을 갱신했습니다."
      : "시안을 갱신했습니다. 인쇄용 JPG 출력 전 실제 센터 회원번호를 조회해 주세요.";
  }
  updateExportState();
  return true;
}

function setField(name, value) {
  const field = form.elements[name];
  if (field && value !== undefined && value !== null && String(value).trim() !== "") field.value = value;
}

async function loadMember() {
  const button = $("#loadMemberButton");
  const memberNumber = normalizeMemberNumber(form.elements.memberNumber.value);
  const centerCode = normalizeCenterCode(form.elements.centerCode.value);
  const useMemberNumber = lookupMode === "memberNumber" && MEMBER_NUMBER_PATTERN.test(memberNumber);

  if (!useMemberNumber && !centerCode) {
    message.textContent = "센터코드 또는 NCC-C-000001 형식의 회원번호를 입력해 주세요.";
    (lookupMode === "centerCode" ? form.elements.centerCode : form.elements.memberNumber).focus();
    return;
  }
  if (lookupMode === "memberNumber" && !MEMBER_NUMBER_PATTERN.test(memberNumber)) {
    message.textContent = "회원번호는 NCC-C-000001 형식으로 입력해 주세요.";
    form.elements.memberNumber.focus();
    return;
  }

  button.disabled = true;
  button.textContent = "조회 중...";
  invalidateVerification("실제 NCC 센터·회원정보를 확인하고 있습니다.");

  try {
    const lookupQuery = useMemberNumber
      ? query(collection(db, "members"), where("memberNumber", "==", memberNumber), limit(2))
      : query(collection(db, "members"), where("centerCode", "==", centerCode));
    const snapshot = await getDocs(lookupQuery);
    const matches = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    const eligible = matches.filter(item =>
      CENTER_ROLES.includes(item.memberType) || (item.centerName && item.centerCode)
    );

    if (!matches.length) {
      message.textContent = useMemberNumber
        ? "해당 회원번호를 찾지 못했습니다."
        : "해당 센터코드를 찾지 못했습니다.";
      return;
    }

    let member;
    if (useMemberNumber) {
      member = matches[0];
    } else {
      const managers = eligible.filter(item => item.memberType === "center_manager");
      if (managers.length === 1) member = managers[0];
      else if (eligible.length === 1) member = eligible[0];
      else {
        message.textContent = "이 센터에는 명함 대상 회원이 여러 명입니다. 정확한 회원번호를 입력해 조회해 주세요.";
        form.elements.memberNumber.focus();
        return;
      }
    }

    setField("name", member.name);
    setField("memberNumber", normalizeMemberNumber(member.memberNumber || memberNumber));
    setField("phone", member.phone);
    setField("email", member.email);
    setField("address", member.address || member.region);

    if (!member.centerName || !member.centerCode || !member.memberNumber) {
      message.textContent = `${member.memberNumber || memberNumber} · ${member.name || "회원"}의 기본정보를 불러왔습니다. JPG 출력은 회원관리에서 센터명·센터코드·센터 역할을 배정한 뒤 가능합니다.`;
      return;
    }

    setField("role", member.memberType === "center_manager" ? "센터장" : member.memberType === "center_staff" ? "센터 팀원" : (member.role || "센터 팀원"));
    setField("centerName", member.centerName);
    setField("centerCode", normalizeCenterCode(member.centerCode));
    setField("memberNumber", normalizeMemberNumber(member.memberNumber));
    setField("phone", member.phone);
    setField("email", member.email);
    setField("address", member.address || member.region);
    verifiedMemberNumber = normalizeMemberNumber(member.memberNumber);
    verifiedCenterCode = normalizeCenterCode(member.centerCode);
    verifiedMemberId = member.id;
    render({ quiet: true });
    message.textContent = `${verifiedMemberNumber} · ${member.name || "센터회원"}의 실제 센터정보를 불러왔습니다.`;
    exportMessage.textContent = "앞면과 뒷면을 각각 300dpi JPG로 내려받을 수 있습니다.";
    updateExportState();
  } catch (error) {
    console.error(error);
    message.textContent = "센터·회원정보를 불러오지 못했습니다. 관리자 권한과 통신 상태를 확인해 주세요.";
  } finally {
    button.disabled = false;
    button.textContent = "센터·회원정보 불러오기";
  }
}

async function waitForArtwork(node) {
  await document.fonts?.ready;
  const images = [...node.querySelectorAll("img")];
  await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  })));
}

function jpegBlobWithDpi(dataUrl) {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), character => character.charCodeAt(0));
  for (let index = 2; index < Math.min(bytes.length - 16, 64); index += 1) {
    const jfif = bytes[index] === 0xff && bytes[index + 1] === 0xe0
      && String.fromCharCode(...bytes.slice(index + 4, index + 9)) === "JFIF\0";
    if (!jfif) continue;
    bytes[index + 11] = 1;
    bytes[index + 12] = 0x01;
    bytes[index + 13] = 0x2c;
    bytes[index + 14] = 0x01;
    bytes[index + 15] = 0x2c;
    break;
  }
  return new Blob([bytes], { type: "image/jpeg" });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCard(side) {
  if (exporting || !exportReady()) {
    exportMessage.textContent = "실제 센터 회원정보를 먼저 불러온 뒤 다시 시도해 주세요.";
    return;
  }
  if (typeof window.html2canvas !== "function") {
    exportMessage.textContent = "JPG 변환 모듈을 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.";
    return;
  }
  if (!render({ quiet: true })) return;

  const data = values();
  const dimensions = { width: 1087, height: 614 };
  const node = side === "front" ? $(".card-front") : $(".card-back");
  const sideLabel = side === "front" ? "앞면" : "뒷면";
  exporting = true;
  updateExportState();
  exportMessage.textContent = `${sideLabel} 300dpi JPG를 만들고 있습니다.`;
  $("#previewSet").classList.add("exporting");

  try {
    await waitForArtwork(node);
    const rect = node.getBoundingClientRect();
    const captured = await window.html2canvas(node, {
      backgroundColor: "#fffdfa",
      scale: Math.max(2, dimensions.width / rect.width),
      useCORS: true,
      logging: false
    });
    const exact = document.createElement("canvas");
    exact.width = dimensions.width;
    exact.height = dimensions.height;
    const context = exact.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(captured, 0, 0, dimensions.width, dimensions.height);
    const blob = jpegBlobWithDpi(exact.toDataURL("image/jpeg", 0.98));
    const safeName = data.name.trim().replace(/[^0-9A-Za-z가-힣_-]+/g, "-");
    download(blob, `${data.memberNumber}_${safeName}_${side === "front" ? "front" : "back"}_92x52_300dpi.jpg`);
    exportMessage.textContent = `${sideLabel} ${dimensions.width}×${dimensions.height}px · 300dpi JPG 다운로드를 시작했습니다.`;
  } catch (error) {
    console.error(error);
    exportMessage.textContent = `${sideLabel} JPG를 만들지 못했습니다. 새로고침 후 다시 시도해 주세요.`;
  } finally {
    $("#previewSet").classList.remove("exporting");
    exporting = false;
    updateExportState();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  render();
});
form.addEventListener("input", event => {
  if (event.target.name === "memberNumber") {
    lookupMode = "memberNumber";
    const nextMemberNumber = normalizeMemberNumber(event.target.value);
    if (nextMemberNumber !== verifiedMemberNumber) invalidateVerification();
    window.clearTimeout(form.lookupTimer);
    if (MEMBER_NUMBER_PATTERN.test(nextMemberNumber)) {
      form.lookupTimer = window.setTimeout(loadMember, 350);
    }
  }
  if (event.target.name === "centerCode") {
    lookupMode = "centerCode";
    if (normalizeCenterCode(event.target.value) !== verifiedCenterCode) invalidateVerification("센터코드가 변경되었습니다. 실제 센터정보를 다시 조회해 주세요.");
  }
  window.clearTimeout(form.renderTimer);
  form.renderTimer = window.setTimeout(() => {
    if (form.checkValidity()) render({ quiet: true });
  }, 180);
});
form.addEventListener("change", () => {
  if (form.checkValidity()) render({ quiet: true });
});
$("#loadMemberButton").addEventListener("click", loadMember);
$$('[data-export]').forEach(button => button.addEventListener("click", () => exportCard(button.dataset.export)));
$("#logoutButton").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, user => {
  const gate = $("#authGate");
  const studio = $("#studioApp");
  if (!user) {
    gate.innerHTML = '<strong>관리자 로그인이 필요합니다.</strong><p><a href="wallet.html">NCC 월렛 로그인으로 이동</a></p>';
    return;
  }
  if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
    gate.innerHTML = "<strong>이 화면은 승인된 관리자만 이용할 수 있습니다.</strong>";
    return;
  }
  gate.hidden = true;
  studio.hidden = false;
  render({ quiet: true });
  updateExportState();
});
