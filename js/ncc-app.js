import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";
import { benefitCatalog } from "./benefit-catalog.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const state = { member: null, notifications: [], benefits: [], orders: [], products: [], activeBenefitFilter: "all", deferredInstall: null };

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const money = value => new Intl.NumberFormat("ko-KR").format(Number(value || 0));
const timestamp = value => value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : null);
const date = value => {
  const result = timestamp(value);
  return result ? result.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "방금 전";
};
const labels = { new: "신규 접수", checking: "확인 중", contacted: "연락 완료", approved: "선정·승인", hold: "보류", confirmed: "진행 확정", paid: "결제 완료", shipping: "배송 중", completed: "이용 완료", cancelled: "취소" };

function safeMember() {
  try { return JSON.parse(sessionStorage.getItem("nccMemberProfile") || "null"); }
  catch { return null; }
}

function openTab(tab) {
  const panel = document.querySelector(`[data-panel="${tab}"]`);
  if (!panel) return;
  $$("[data-panel]").forEach(item => { item.hidden = item !== panel; });
  $$("[data-tab]").forEach(item => item.classList.toggle("active", item.dataset.tab === tab));
  history.replaceState(null, "", `${location.pathname}${location.search}#${tab}`);
  $("#appMain").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function featureCards() {
  const ids = ["first-resort", "premium-skincare", "daily-local"];
  const items = ids.map(id => benefitCatalog.find(item => item.id === id)).filter(Boolean);
  $("#featuredBenefits").innerHTML = items.map(item => `<a class="featured-benefit" href="benefit-detail.html?id=${encodeURIComponent(item.id)}">
    <img src="${esc(item.image)}" alt="${esc(item.title)}">
    <div class="featured-benefit-copy"><span class="benefit-tier">${esc(item.tier.toUpperCase())} BENEFIT</span><h3>${esc(item.title)}</h3><p>${esc(item.lead)}</p><b>자세히 보기 →</b></div>
  </a>`).join("");
}

function renderBenefits() {
  const visible = benefitCatalog.filter(item => state.activeBenefitFilter === "all" || item.tier === state.activeBenefitFilter);
  $("#appBenefitList").innerHTML = visible.map(item => `<a class="app-benefit-card" href="benefit-detail.html?id=${encodeURIComponent(item.id)}">
    <img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">
    <div class="app-benefit-copy"><small>${esc(item.tier.toUpperCase())} · ${esc(item.category)}</small><h2>${esc(item.title)}</h2><p>${esc(item.lead)}</p><b>조건 확인·신청 →</b></div>
  </a>`).join("");
}

function renderProducts() {
  const target = $("#appGroupBuyList");
  if (!state.products.length) {
    target.innerHTML = '<div class="empty-app-state">현재 공개된 공동구매 상품을 준비하고 있습니다.<br>새 상품은 알림으로 먼저 알려드릴게요.</div>';
    return;
  }
  target.innerHTML = state.products.slice(0, 6).map(item => `<a class="app-product-card" href="groupbuy-detail.html?id=${encodeURIComponent(item.id)}">
    <img src="${esc(item.image || "images/NCC_consumer.jpg")}" alt="${esc(item.title || "NCC 공동구매 상품")}" loading="lazy">
    <div class="app-product-copy"><small>${esc(item.category || "NCC 공동구매")}</small><h2>${esc(item.title || "공동구매 상품")}</h2><p>목표 ${money(item.minParticipants)}명 · ${esc(item.endDate || "일정 안내")}</p><b>${money(item.price)}원</b></div>
  </a>`).join("");
}

function renderAccount() {
  const member = state.member;
  if (!member) return;
  const name = esc(member.name || member.displayName || "회원");
  $("#greeting").innerHTML = `${name}님,<br>오늘의 NCC 혜택을 확인하세요`;
  $("#memberLead").textContent = `${member.region || "내 지역"}을 기준으로 혜택과 공동구매 소식을 편하게 확인할 수 있어요.`;
  $("#memberAccountCard").innerHTML = `<p class="app-kicker">NCC MEMBER</p><h2>${name}님의<br>디지털 NCC 월렛</h2><a href="wallet.html">내 QR·회원카드 열기 <span>→</span></a>`;
}

function renderActivity() {
  const benefits = state.benefits.length;
  const orders = state.orders.length;
  const unread = state.notifications.filter(item => item.read !== true).length;
  $("#activitySummary").innerHTML = `<a href="wallet.html"><span>혜택 신청</span><strong>${benefits ? `${benefits}건 진행 중` : "신청 내역 확인"}</strong></a>
    <a href="wallet.html#walletActivity"><span>공동구매</span><strong>${orders ? `${orders}건 주문 내역` : "주문 내역 확인"}</strong></a>
    <button type="button" data-open-tab="notifications"><span>새 알림</span><strong>${unread ? `${unread}건 확인하기` : "새 소식 확인"}</strong></button>`;
  $("#notificationDot").hidden = unread === 0;
  $("[data-open-tab=notifications]")?.addEventListener("click", () => openTab("notifications"));
}

function notificationCard(item) {
  const href = /^([a-z-]+\.html)(\?[A-Za-z0-9_%.=&-]+)?(#[-A-Za-z0-9_]+)?$/.test(String(item.href || "")) ? item.href : "wallet.html#walletActivity";
  return `<article class="notification-card ${item.read === true ? "" : "unread"}">
    <span class="notification-mark" aria-hidden="true">✦</span>
    <div><h2>${esc(item.title || "NCC 새 소식")}</h2><p>${esc(item.message || "새 안내가 등록되었습니다.")}</p><small>${esc(date(item.createdAt))}</small><a href="${esc(href)}">내용 확인 →</a></div>
  </article>`;
}

function renderNotifications() {
  const target = $("#appNotificationList");
  if (!state.member) {
    target.innerHTML = '<div class="empty-app-state">NCC 월렛에 로그인하면 신청 결과와 주문·배송 소식을 이곳에서 확인할 수 있습니다.</div>';
    return;
  }
  if (!state.notifications.length) {
    target.innerHTML = '<div class="empty-app-state">아직 새로운 알림이 없습니다.<br>새 혜택과 신청 결과는 이곳에 차례로 표시됩니다.</div>';
    return;
  }
  target.innerHTML = state.notifications.map(notificationCard).join("");
}

async function loadProducts() {
  try {
    const snapshot = await getDocs(query(collection(db, "groupBuyProducts"), where("published", "==", true)));
    state.products = snapshot.docs.map(document => ({ id: document.id, ...document.data() })).filter(item => item.status !== "draft").sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  } catch (error) {
    console.error("NCC 공동구매 목록을 불러오지 못했습니다.", error);
  }
  renderProducts();
}

async function loadMemberActivity() {
  if (!state.member?.id) {
    renderActivity();
    renderNotifications();
    return;
  }
  const memberId = state.member.id;
  const results = await Promise.allSettled([
    getDocs(query(collection(db, "benefitApplications"), where("memberId", "==", memberId))),
    getDocs(query(collection(db, "groupBuyOrders"), where("memberId", "==", memberId))),
    getDocs(query(collection(db, "memberNotifications"), where("memberId", "==", memberId)))
  ]);
  const entries = results.map(result => result.status === "fulfilled" ? result.value.docs.map(document => ({ id: document.id, ...document.data() })) : []);
  [state.benefits, state.orders, state.notifications] = entries;
  state.notifications.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  renderActivity();
  renderNotifications();
}

function updatePermissionUi() {
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const text = permission === "granted" ? "알림 허용됨" : permission === "denied" ? "알림이 차단됨" : "알림 설정";
  $("#notificationStatusButton").textContent = text;
  $("#notificationButton span").textContent = permission === "granted" ? "알림 켬" : "알림";
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    alert("이 기기에서는 알림 설정을 지원하지 않습니다. 최신 Safari 또는 Chrome에서 다시 열어 주세요.");
    return;
  }
  if (Notification.permission === "denied") {
    alert("알림이 차단되어 있습니다. 기기 설정에서 ncc365.com 알림을 허용해 주세요.");
    return;
  }
  const result = await Notification.requestPermission();
  updatePermissionUi();
  if (result === "granted") {
    localStorage.setItem("nccAppNotificationOptIn", "true");
    alert("NCC 알림을 허용했습니다. 새 혜택과 주문 안내는 알림 서비스 연결 후 순서대로 전달됩니다.");
  }
}

function openInstallDialog() {
  const dialog = $("#installDialog");
  if (!dialog.open) dialog.showModal();
  $("#androidInstallGuide").classList.toggle("hidden", !state.deferredInstall);
  $("#iosInstallGuide").classList.toggle("hidden", Boolean(state.deferredInstall));
}

async function installApp() {
  if (!state.deferredInstall) { openInstallDialog(); return; }
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  $("#installDialog").close();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("sw.js").catch(error => console.error("NCC 앱 서비스워커 등록 실패", error));
}

function wireUi() {
  $$("[data-tab]").forEach(button => button.addEventListener("click", () => openTab(button.dataset.tab)));
  $$("[data-open-tab]").forEach(button => button.addEventListener("click", () => openTab(button.dataset.openTab)));
  $$("[data-benefit-filter]").forEach(button => button.addEventListener("click", () => {
    state.activeBenefitFilter = button.dataset.benefitFilter;
    $$("[data-benefit-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderBenefits();
  }));
  $("#installButton").addEventListener("click", openInstallDialog);
  $("#noticeInstallButton").addEventListener("click", openInstallDialog);
  $("#androidInstallButton").addEventListener("click", installApp);
  $("#notificationButton").addEventListener("click", requestNotifications);
  $("#notificationStatusButton").addEventListener("click", requestNotifications);
  $("[data-close-dialog]").addEventListener("click", () => $("#installDialog").close());
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); state.deferredInstall = event; });
  window.addEventListener("appinstalled", () => { state.deferredInstall = null; });
}

featureCards();
renderBenefits();
renderProducts();
renderNotifications();
updatePermissionUi();
wireUi();
registerServiceWorker();
loadProducts();

const initialTab = location.hash.replace("#", "");
if (["home", "benefits", "groupbuy", "notifications", "my"].includes(initialTab)) openTab(initialTab);

onAuthStateChanged(auth, user => {
  state.member = user ? safeMember() : null;
  renderAccount();
  loadMemberActivity();
});
