import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = selector => document.querySelector(selector);
const orderId = new URLSearchParams(location.search).get("orderId") || "";
const money = value => `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
let submitting = false;

async function loadTossPayments() {
  if (typeof window.TossPayments === "function") return window.TossPayments;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v2/standard";
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("토스페이먼츠 결제창을 불러오지 못했습니다.")), { once: true });
    document.head.append(script);
  });
  if (typeof window.TossPayments !== "function") throw new Error("토스페이먼츠 결제창을 불러오지 못했습니다.");
  return window.TossPayments;
}

async function paymentApi(path, user, body) {
  const response = await fetch(`/api/payments/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.message || "결제 요청을 처리하지 못했습니다.");
  return result;
}

function showUnavailable(message) {
  $("#checkoutLoading").hidden = true;
  $("#checkoutUnavailable").hidden = false;
  if (message) $("#checkoutUnavailable p").textContent = message;
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace(`wallet.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  if (!orderId) {
    showUnavailable("결제할 신청내역을 찾을 수 없습니다.");
    return;
  }
  try {
    const config = await paymentApi("config", user);
    if (!config.enabled || !config.checkoutEnabled || config.provider !== "toss") {
      showUnavailable();
      return;
    }
    const prepared = await paymentApi("prepare", user, { orderId });
    const checkout = prepared.checkout;
    if (!checkout || checkout.provider !== "toss" || checkout.amount !== prepared.payment.amount) {
      throw new Error("결제 준비정보를 확인할 수 없습니다.");
    }
    const TossPayments = await loadTossPayments();

    $("#checkoutTitle").textContent = checkout.orderName;
    $("#checkoutAmount").textContent = money(checkout.amount);
    const widgets = TossPayments(checkout.clientKey).widgets({ customerKey: checkout.customerKey });
    await widgets.setAmount({ currency: "KRW", value: checkout.amount });
    await Promise.all([
      widgets.renderPaymentMethods({ selector: "#payment-method", variantKey: "DEFAULT" }),
      widgets.renderAgreement({ selector: "#agreement", variantKey: "AGREEMENT" }),
    ]);

    $("#checkoutLoading").hidden = true;
    $("#checkoutContent").hidden = false;
    const button = $("#payButton");
    button.disabled = false;
    button.textContent = `${money(checkout.amount)} 결제하기`;
    button.addEventListener("click", async () => {
      if (submitting) return;
      submitting = true;
      button.disabled = true;
      $("#checkoutError").textContent = "";
      try {
        await widgets.requestPayment({
          orderId: checkout.providerOrderId,
          orderName: checkout.orderName,
          successUrl: checkout.successUrl,
          failUrl: checkout.failUrl,
          customerEmail: user.email || undefined,
          customerName: user.displayName || undefined,
        });
      } catch (error) {
        if (error?.code !== "USER_CANCEL") {
          console.error("Payment widget request failed.", String(error?.code || "unknown"));
          $("#checkoutError").textContent = "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.";
        }
        submitting = false;
        button.disabled = false;
      }
    });
  } catch (error) {
    console.error("Checkout preparation failed.", error?.message || error);
    showUnavailable(error?.message || "결제 준비 중 오류가 발생했습니다.");
  }
});
