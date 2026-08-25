import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = selector => document.querySelector(selector);
const ADMIN_EMAIL = "kpa100plus@gmail.com";
let payments = [];

const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const money = value => `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
const statusLabels = {
  ready: "결제 준비",
  paid: "결제완료",
  partially_refunded: "부분환불",
  refunded: "전액환불",
  cancelled: "결제취소"
};

async function paymentApi(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("관리자 로그인이 필요합니다.");
  const headers = { ...(options.headers || {}), authorization: `Bearer ${await user.getIdToken()}` };
  if (options.body) headers["content-type"] = "application/json";
  const response = await fetch(`/api/payments/${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.message || "결제관리 요청을 처리하지 못했습니다.");
  return body;
}

async function loadPayments() {
  const message = $("#paymentMessage");
  message.textContent = "테스트 결제내역을 불러오는 중입니다.";
  try {
    const configResponse = await fetch("/api/payments/config", { headers: { accept: "application/json" } });
    const config = await configResponse.json();
    if (!config.enabled) throw new Error("Cloudflare D1 결제 데이터베이스 연결과 테스트모드 설정이 필요합니다.");
    const body = await paymentApi("admin/list", { method: "GET" });
    payments = body.payments || [];
    render();
    message.textContent = "";
  } catch (error) {
    console.error(error);
    payments = [];
    render();
    message.textContent = error.message || "테스트 결제내역을 불러오지 못했습니다.";
  }
}

function render() {
  const status = $("#paymentStatusFilter").value;
  const keyword = $("#paymentSearch").value.trim().toLowerCase();
  const visible = payments.filter(payment =>
    (status === "all" || payment.status === status)
    && (!keyword || [payment.orderId, payment.orderReceipt, payment.memberEmail].some(value => String(value || "").toLowerCase().includes(keyword)))
  );
  $("#paymentCount").textContent = payments.length;
  $("#paidCount").textContent = payments.filter(payment => ["paid", "partially_refunded", "refunded"].includes(payment.status)).length;
  $("#refundCount").textContent = payments.filter(payment => Number(payment.refundedAmount || 0) > 0).length;
  $("#paidAmount").textContent = money(payments.reduce((sum, payment) => sum + Number(payment.paidAmount || 0), 0));
  $("#paymentList").innerHTML = visible.length ? visible.map(payment => {
    const available = Number(payment.paidAmount || 0) - Number(payment.refundedAmount || 0);
    const refundControls = ["paid", "partially_refunded"].includes(payment.status) ? `
      <label>환불금액<input id="refund-${safe(payment.id)}" type="number" min="1" max="${available}" value="${available}"></label>
      <button type="button" data-refund="${safe(payment.id)}">선택금액 환불</button>` : "";
    const cancelControl = payment.status === "ready"
      ? `<button class="danger" type="button" data-cancel="${safe(payment.id)}">준비 결제 취소</button>` : "";
    return `<article class="application-card payment-card">
      <div class="payment-card-head"><div><span class="payment-status">${safe(statusLabels[payment.status] || payment.status)}</span><h2>${safe(payment.orderReceipt)}</h2><div class="payment-meta"><span>주문 ${safe(payment.orderId)}</span><span>${safe(payment.memberEmail)}</span><span>${safe(payment.updatedAt)}</span></div></div><b class="payment-money">${money(payment.amount)}</b></div>
      <div class="payment-meta"><span>결제 ${money(payment.paidAmount)}</span><span>환불 ${money(payment.refundedAmount)}</span><span>실결제 아님 · TEST</span></div>
      ${(refundControls || cancelControl) ? `<div class="payment-controls">${refundControls}${cancelControl}</div>` : ""}
    </article>`;
  }).join("") : '<div class="empty">조건에 맞는 테스트 결제내역이 없습니다.</div>';
  document.querySelectorAll("[data-refund]").forEach(button => button.addEventListener("click", () => refund(button.dataset.refund, button)));
  document.querySelectorAll("[data-cancel]").forEach(button => button.addEventListener("click", () => cancel(button.dataset.cancel, button)));
}

async function refund(paymentId, button) {
  const payment = payments.find(item => item.id === paymentId);
  const amount = Number(document.getElementById(`refund-${paymentId}`)?.value);
  if (!payment || !Number.isSafeInteger(amount) || amount < 1) return;
  if (!confirm(`${money(amount)} 테스트 환불을 처리하시겠습니까? 실제 금전이동은 없습니다.`)) return;
  button.disabled = true;
  try {
    await paymentApi("admin/refund", { method: "POST", body: JSON.stringify({ paymentId, amount, idempotencyKey: `refund_${crypto.randomUUID().replaceAll("-", "")}` }) });
    await loadPayments();
  } catch (error) {
    alert(error.message || "테스트 환불을 처리하지 못했습니다.");
  } finally {
    button.disabled = false;
  }
}

async function cancel(paymentId, button) {
  if (!confirm("이 준비 상태의 테스트 결제를 취소하시겠습니까?")) return;
  button.disabled = true;
  try {
    await paymentApi("admin/cancel", { method: "POST", body: JSON.stringify({ paymentId, idempotencyKey: `cancel_${crypto.randomUUID().replaceAll("-", "")}` }) });
    await loadPayments();
  } catch (error) {
    alert(error.message || "테스트 결제를 취소하지 못했습니다.");
  } finally {
    button.disabled = false;
  }
}

$("#loginButton").addEventListener("click", async () => {
  $("#loginError").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("#adminEmail").value.trim(), $("#adminPassword").value);
  } catch {
    $("#loginError").textContent = "로그인 정보를 확인해 주세요.";
  }
});
$("#logoutButton").addEventListener("click", () => signOut(auth));
$("#refreshButton").addEventListener("click", loadPayments);
$("#paymentStatusFilter").addEventListener("change", render);
$("#paymentSearch").addEventListener("input", render);

onAuthStateChanged(auth, async user => {
  if (user?.email?.toLowerCase() === ADMIN_EMAIL) {
    $("#loginArea").hidden = true;
    $("#adminArea").hidden = false;
    await loadPayments();
  } else {
    if (user) await signOut(auth);
    $("#loginArea").hidden = false;
    $("#adminArea").hidden = true;
  }
});
