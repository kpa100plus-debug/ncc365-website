import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const money = value => `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;

function showResult({ success, title, message, payment }) {
  $("#resultLoading").hidden = true;
  $("#resultContent").hidden = false;
  $("#resultBadge").textContent = success ? "결제 완료" : "결제 미완료";
  $("#resultBadge").classList.toggle("failure", !success);
  $("#resultTitle").textContent = title;
  $("#resultMessage").textContent = message;
  if (payment) {
    $("#resultDetails").hidden = false;
    $("#resultReceipt").textContent = payment.orderReceipt || "확인 중";
    $("#resultAmount").textContent = money(payment.paidAmount || payment.amount);
    $("#resultStatus").textContent = payment.status === "paid" ? "결제완료" : payment.status;
    if (payment.receiptUrl) {
      try {
        const receipt = new URL(payment.receiptUrl);
        if (receipt.protocol === "https:") {
          $("#receiptLink").href = receipt.toString();
          $("#receiptLink").hidden = false;
        }
      } catch { /* Invalid receipt URLs are not rendered. */ }
    }
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace(`wallet.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  if (params.get("result") !== "success") {
    showResult({
      success: false,
      title: "결제가 완료되지 않았습니다",
      message: "결제수단을 다시 확인하거나 신청내역에서 결제를 다시 진행해 주세요.",
    });
    return;
  }
  const paymentId = params.get("paymentId") || "";
  const paymentKey = params.get("paymentKey") || "";
  const providerOrderId = params.get("orderId") || "";
  const amount = Number(params.get("amount"));
  if (!paymentId || !paymentKey || !providerOrderId || !Number.isSafeInteger(amount)) {
    showResult({ success: false, title: "결제정보를 확인할 수 없습니다", message: "신청내역에서 결제상태를 다시 확인해 주세요." });
    return;
  }
  const storageKey = `ncc-payment-confirm-${paymentId}`;
  let idempotencyKey = sessionStorage.getItem(storageKey);
  if (!idempotencyKey) {
    idempotencyKey = `confirm_${crypto.randomUUID().replaceAll("-", "")}`;
    sessionStorage.setItem(storageKey, idempotencyKey);
  }
  try {
    const response = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ paymentId, paymentKey, providerOrderId, amount, idempotencyKey }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.message || "결제 승인을 확인하지 못했습니다.");
    sessionStorage.removeItem(storageKey);
    history.replaceState(null, "", "/payment-result.html");
    showResult({ success: true, title: "결제가 완료되었습니다", message: "NCC 공동구매 신청내역에서 결제와 배송상태를 확인할 수 있습니다.", payment: body.payment });
  } catch (error) {
    console.error("Payment confirmation failed.", error?.message || error);
    showResult({ success: false, title: "결제상태 확인이 필요합니다", message: error?.message || "재결제하지 말고 신청내역에서 상태를 확인해 주세요." });
  }
});
