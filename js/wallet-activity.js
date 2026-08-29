import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const db = getFirestore(app);
const memberArea = document.querySelector("#memberArea");
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const money = value => new Intl.NumberFormat("ko-KR").format(Number(value || 0));
const date = value => value?.toDate?.().toLocaleDateString("ko-KR") || "등록일 확인 중";
const labels = { new: "신규 접수", checking: "확인 중", contacted: "연락 완료", approved: "선정·승인", hold: "보류", confirmed: "진행 확정", paid: "결제 완료", shipping: "배송 중", completed: "이용 완료", cancelled: "취소" };

let records = [];
let active = "all";
let loaded = false;

document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="css/wallet-activity.css?v=20260829-2">');

function shell() {
  if (document.querySelector("#walletActivity")) return;
  const logout = memberArea.querySelector(".logout-button");
  const html = `<section id="walletActivity" class="wallet-activity">
    <div class="wallet-activity-head">
      <div><p class="eyebrow">MY ACTIVITY</p><h2>알림·신청·주문·배송·후기</h2></div>
      <div class="wallet-activity-tabs" role="tablist" aria-label="월렛 이용내역 구분">
        <button class="active" data-activity="all">전체</button>
        <button data-activity="notification">알림함</button>
        <button data-activity="benefit">혜택</button>
        <button data-activity="groupbuy">공동구매</button>
        <button data-activity="review">후기 가능</button>
      </div>
    </div>
    <p class="wallet-notice-guide">혜택 모집·처리상태 안내는 이 알림함에 표시됩니다. 이메일·문자는 별도 발송된 경우에만 전달됩니다.</p>
    <div id="walletActivitySummary" class="wallet-activity-summary"></div>
    <div id="walletActivityList" class="wallet-activity-list"><div class="wallet-empty">이용내역을 불러오고 있습니다.</div></div>
  </section>`;
  if (logout) logout.insertAdjacentHTML("beforebegin", html);
  else memberArea.insertAdjacentHTML("beforeend", html);
  document.querySelectorAll("[data-activity]").forEach(button => button.addEventListener("click", () => {
    active = button.dataset.activity;
    document.querySelectorAll("[data-activity]").forEach(item => item.classList.toggle("active", item === button));
    render();
  }));
}

async function load() {
  if (loaded) return;
  let member;
  try {
    member = JSON.parse(sessionStorage.getItem("nccMemberProfile") || "null");
  } catch {
    member = null;
  }
  if (!member?.id) return;
  shell();
  loaded = true;
  try {
    const [benefits, orders, notifications] = await Promise.all([
      getDocs(query(collection(db, "benefitApplications"), where("memberId", "==", member.id))),
      getDocs(query(collection(db, "groupBuyOrders"), where("memberId", "==", member.id))),
      getDocs(query(collection(db, "memberNotifications"), where("memberId", "==", member.id)))
    ]);
    records = [
      ...benefits.docs.map(item => ({ id: item.id, kind: "benefit", ...item.data() })),
      ...orders.docs.map(item => ({ id: item.id, kind: "groupbuy", ...item.data() })),
      ...notifications.docs.map(item => ({ id: item.id, kind: "notification", ...item.data() }))
    ].sort((first, second) => (second.createdAt?.seconds || 0) - (first.createdAt?.seconds || 0));
    render();
  } catch (error) {
    console.error(error);
    document.querySelector("#walletActivityList").innerHTML = '<div class="wallet-empty">이용내역을 불러오지 못했습니다. Firestore 회원 본인조회 권한을 확인해 주세요.</div>';
  }
}

function reviewEligible(item) {
  return (item.kind === "benefit" && item.status === "approved") || (item.kind === "groupbuy" && item.status === "completed");
}

function render() {
  const notificationCount = records.filter(item => item.kind === "notification").length;
  const benefitCount = records.filter(item => item.kind === "benefit").length;
  const orderCount = records.filter(item => item.kind === "groupbuy").length;
  const shippingCount = records.filter(item => item.status === "shipping").length;
  const reviewCount = records.filter(reviewEligible).length;
  document.querySelector("#walletActivitySummary").innerHTML = `<div><span>월렛 알림</span><b>${notificationCount}</b></div><div><span>혜택 신청</span><b>${benefitCount}</b></div><div><span>공동구매 주문</span><b>${orderCount}</b></div><div><span>배송 중</span><b>${shippingCount}</b></div><div><span>후기 가능</span><b>${reviewCount}</b></div>`;
  const visible = records.filter(item => active === "all" || item.kind === active || (active === "review" && reviewEligible(item)));
  document.querySelector("#walletActivityList").innerHTML = visible.length ? visible.map(card).join("") : '<div class="wallet-empty">해당 이용내역이 없습니다.</div>';
}

function safeHref(value) {
  const href = String(value || "");
  return /^benefit-detail\.html\?id=[A-Za-z0-9_%.-]*$/.test(href) ? href : "benefits.html";
}

function card(item) {
  if (item.kind === "notification") {
    return `<article class="wallet-record wallet-notification">
      <div>
        <small>NCC WALLET NOTICE · ${esc(date(item.createdAt))}</small>
        <h3>${esc(item.title || "NCC 알림")}</h3>
        <p>${esc(item.message || "새 안내가 등록되었습니다.")}</p>
        <div class="wallet-record-meta"><span class="wallet-status">${esc(labels[item.status] || "알림")}</span><span>${esc(item.offerTitle || "NCC 혜택")}</span></div>
      </div>
      <div class="wallet-record-action"><a href="${esc(safeHref(item.href))}">혜택 상세 보기</a></div>
    </article>`;
  }

  const benefit = item.kind === "benefit";
  const eligible = reviewEligible(item);
  const title = benefit ? item.offerTitle : item.productTitle;
  const receipt = item.receipt || "접수번호 확인 중";
  const detail = benefit ? `신청구분 ${item.type || "혜택 신청"}` : `수량 ${Number(item.quantity || 0)}개 · ${money(item.totalPrice)}원`;
  const detailUrl = benefit ? `benefit-detail.html?id=${encodeURIComponent(item.offerId || "")}` : `order-detail.html?id=${encodeURIComponent(item.id)}`;
  const reviewUrl = benefit ? `benefit-detail.html?id=${encodeURIComponent(item.offerId || "")}#reviewForm` : `groupbuy-detail.html?id=${encodeURIComponent(item.productId || "")}#reviewForm`;
  return `<article class="wallet-record">
    <div>
      <small>${benefit ? "NCC BENEFIT" : "GROUP BUY"} · ${esc(receipt)}</small>
      <h3>${esc(title || "이용내역")}</h3>
      <p>${esc(detail)}</p>
      <div class="wallet-record-meta"><span class="wallet-status">${esc(labels[item.status] || item.status || "상태 확인 중")}</span><span>${esc(date(item.createdAt))}</span></div>
    </div>
    <div class="wallet-record-action"><a href="${detailUrl}">상세 보기</a>${eligible ? `<a href="${reviewUrl}">이용 후기 작성</a>` : ""}</div>
  </article>`;
}

if (memberArea) {
  const observer = new MutationObserver(() => {
    if (!memberArea.hidden) load();
  });
  observer.observe(memberArea, { attributes: true, attributeFilter: ["hidden"] });
  if (!memberArea.hidden) load();
}
