import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN = "kpa100plus@gmail.com";
const $ = selector => document.querySelector(selector);
let certificates = [];

const statusLabels = { active: "정상 발급", revoked: "효력 정지", expired: "유효기간 만료", sample: "검토용 샘플" };
const typeLabels = {
  business_certificate: "NCC 사업체 인증서",
  store_certificate: "NCC 매장 인증서",
  excellent_company: "소비자선정 우수기업",
  excellent_product_service: "소비자선정 우수상품·서비스",
  official_partner: "공식 파트너",
  center_appointment: "센터장 임명장"
};

const normalizeNumber = value => String(value || "").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
const certificatePattern = /^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/;
const certificateDefaults = {
  business_certificate: { prefix: "BC", title: "NCC 사업체 인증서" },
  store_certificate: { prefix: "SC", title: "NCC 매장 인증서" }
};
const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const byCreated = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

$("#loginButton").onclick = async () => {
  try {
    $("#loginError").textContent = "";
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
  } catch {
    $("#loginError").textContent = "로그인 정보를 확인해 주세요.";
  }
};
$("#logoutButton").onclick = () => signOut(auth);
$("#refreshButton").onclick = load;
$("#statusFilter").onchange = render;
$("#certificateSearch").oninput = render;
$("#newCertificateButton").onclick = () => openForm();
$("#cancelCertificateButton").onclick = () => $("#certificateForm").hidden = true;

onAuthStateChanged(auth, async user => {
  if (user?.email?.toLowerCase() === ADMIN) {
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
  try {
    const snapshot = await getDocs(collection(db, "certificates"));
    certificates = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort(byCreated);
    render();
    updateStats();
  } catch (error) {
    console.error(error);
    $("#certificateList").innerHTML = '<div class="empty">인증서 기록을 불러오지 못했습니다. Firestore 권한을 확인해 주세요.</div>';
  }
}

function updateStats() {
  $("#totalCount").textContent = certificates.length;
  $("#activeCount").textContent = certificates.filter(item => item.status === "active").length;
  $("#revokedCount").textContent = certificates.filter(item => item.status === "revoked").length;
  $("#sampleCount").textContent = certificates.filter(item => item.status === "sample").length;
}

function render() {
  const status = $("#statusFilter").value;
  const keyword = $("#certificateSearch").value.trim().toLowerCase();
  const rows = certificates.filter(item =>
    (status === "all" || item.status === status) &&
    (!keyword || [item.certificateNumber, item.recipientName, item.category, item.title]
      .some(value => String(value || "").toLowerCase().includes(keyword)))
  );

  $("#certificateList").innerHTML = rows.length ? rows.map(item => `
    <article class="application-card">
      <div>
        <p class="receipt">${escapeHtml(item.certificateNumber)} · ${escapeHtml(typeLabels[item.certificateType] || item.certificateType)}</p>
        <h2>${escapeHtml(item.recipientName)} <small class="certificate-status-${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</small></h2>
        <div class="meta"><span>${escapeHtml(item.title)}</span><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.issuedAt)}</span><span>${item.public ? "공개" : "비공개"}</span></div>
      </div>
      <div class="card-actions">
        <button data-edit="${escapeHtml(item.id)}">기록 수정</button>
        <a href="certificate-verify.html?id=${encodeURIComponent(item.certificateNumber)}" target="_blank" rel="noopener">공개 조회</a>
        <a href="certificate-print.html?id=${encodeURIComponent(item.certificateNumber)}" target="_blank" rel="noopener">인쇄·PDF</a>
      </div>
    </article>`).join("") : '<div class="empty">조건에 맞는 인증서 기록이 없습니다.</div>';

  document.querySelectorAll("[data-edit]").forEach(button => {
    button.onclick = () => openForm(certificates.find(item => item.id === button.dataset.edit));
  });
}

function openForm(item = {}) {
  const form = $("#certificateForm");
  form.reset();
  form.elements.originalNumber.value = item.certificateNumber || "";
  for (const [key, value] of Object.entries(item)) {
    if (form.elements[key] && !["createdAt", "updatedAt"].includes(key)) {
      form.elements[key].value = typeof value === "boolean" ? String(value) : value ?? "";
    }
  }
  if (!item.certificateNumber) {
    form.elements.status.value = "sample";
    form.elements.public.value = "true";
    form.elements.issuedAt.valueAsDate = new Date();
    applyCertificateDefaults(form);
  }
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function nextCertificateNumber(prefix) {
  const year = new Date().getFullYear();
  const expression = new RegExp(`^NCC-${prefix}-${year}-(\\d{4})$`);
  const highest = certificates.reduce((max, item) => {
    const match = normalizeNumber(item.certificateNumber).match(expression);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `NCC-${prefix}-${year}-${String(highest + 1).padStart(4, "0")}`;
}

function applyCertificateDefaults(form) {
  const preset = certificateDefaults[form.elements.certificateType.value];
  if (!preset) return;
  form.elements.certificateNumber.value = nextCertificateNumber(preset.prefix);
  form.elements.certificateNumber.placeholder = `NCC-${preset.prefix}-${new Date().getFullYear()}-0001`;
  form.elements.title.value = preset.title;
}

$("#certificateForm").elements.certificateType.addEventListener("change", event => {
  const form = event.currentTarget.form;
  if (!form.elements.originalNumber.value) applyCertificateDefaults(form);
});

$("#certificateForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  const originalNumber = normalizeNumber(values.originalNumber);
  const certificateNumber = normalizeNumber(values.certificateNumber);
  delete values.originalNumber;

  if (!certificatePattern.test(certificateNumber) || certificateNumber.length > 50) {
    $("#certificateMessage").textContent = "인증번호 형식을 확인해 주세요.";
    return;
  }
  const preset = certificateDefaults[values.certificateType];
  if (preset && !new RegExp(`^NCC-${preset.prefix}-\\d{4}-\\d{4}$`).test(certificateNumber)) {
    $("#certificateMessage").textContent = `${preset.title} 번호는 NCC-${preset.prefix}-연도-일련번호 형식만 사용할 수 있습니다.`;
    return;
  }
  if (originalNumber && originalNumber !== certificateNumber) {
    $("#certificateMessage").textContent = "등록된 인증번호는 변경할 수 없습니다. 새 기록으로 등록해 주세요.";
    return;
  }

  submit.disabled = true;
  $("#certificateMessage").textContent = "저장 중입니다.";
  try {
    const target = doc(db, "certificates", certificateNumber);
    const existing = await getDoc(target);
    const payload = {
      certificateNumber,
      certificateType: values.certificateType,
      title: values.title.trim(),
      recipientName: values.recipientName.trim(),
      representativeName: values.representativeName.trim(),
      category: values.category.trim(),
      region: values.region.trim(),
      evaluationGroup: values.evaluationGroup.trim(),
      issuedAt: values.issuedAt,
      validUntil: values.validUntil,
      issuer: values.issuer.trim(),
      imageUrl: values.imageUrl.trim(),
      status: values.status,
      public: values.public === "true",
      updatedAt: serverTimestamp()
    };
    if (!existing.exists()) payload.createdAt = serverTimestamp();

    const batch = writeBatch(db);
    batch.set(target, payload, { merge: true });
    const logRef = doc(collection(db, "certificateLogs"));
    batch.set(logRef, {
      certificateNumber,
      eventType: existing.exists() ? "updated" : "created",
      status: values.status,
      public: values.public === "true",
      actorEmail: auth.currentUser.email,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    form.hidden = true;
    await load();
  } catch (error) {
    console.error(error);
    $("#certificateMessage").textContent = "발급 기록을 저장하지 못했습니다.";
  } finally {
    submit.disabled = false;
  }
};
