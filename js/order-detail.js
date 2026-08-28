import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = selector => document.querySelector(selector);
const orderId = new URLSearchParams(location.search).get("id");
const money = value => `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
const known = value => value === undefined || value === null || value === "" ? "기록 없음" : String(value);
const statusLabels = { new: "신규 접수", checking: "확인중", confirmed: "주문확정", paid: "결제확인", shipping: "배송중", completed: "완료", cancelled: "취소" };
const paymentLabels = { ready: "결제 준비", paid: "결제완료", partially_refunded: "부분환불", refunded: "전액환불", cancelled: "결제취소" };

function date(value) {
  const parsed = value?.toDate?.();
  return parsed ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(parsed) : "기록 없음";
}

function text(selector, value) {
  $(selector).textContent = known(value);
}

async function paymentState(user) {
  try {
    const authorization = `Bearer ${await user.getIdToken()}`;
    const [configResponse, historyResponse] = await Promise.all([
      fetch("/api/payments/config", { headers: { accept: "application/json", authorization } }),
      fetch("/api/payments/me", { headers: { accept: "application/json", authorization } }),
    ]);
    const [config, history] = await Promise.all([configResponse.json(), historyResponse.json()]);
    const payment = (history.payments || []).find(item => item.orderId === orderId);
    return { label: payment ? paymentLabels[payment.status] || payment.status : "미결제", payment, config };
  } catch {
    return { label: "확인할 수 없음", payment: null, config: { checkoutEnabled: false } };
  }
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace(`wallet.html?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  try {
    if (!orderId) throw new Error("신청번호가 없습니다.");
    const snapshot = await getDoc(doc(db, "groupBuyOrders", orderId));
    if (!snapshot.exists()) throw new Error("본인 신청내역을 확인할 수 없습니다.");
    const order = snapshot.data();
    const product = order.productSnapshot || {};
    const delivery = order.deliverySnapshot || {};
    const application = order.applicationSnapshot || {};
    text("#detailProductTitle", product.title || order.productTitle);
    text("#detailReceipt", order.receipt);
    text("#detailStatus", statusLabels[order.status] || order.status);
    const image = $("#detailImage");
    const imageUrl = product.image || "";
    if (imageUrl) {
      image.src = imageUrl;
      image.alt = `${product.title || order.productTitle || "공동구매 상품"} 이미지`;
    } else image.hidden = true;
    text("#detailDescription", product.description);
    text("#detailOption", product.option);
    text("#detailQuantity", `${application.quantity ?? order.quantity ?? "기록 없음"}개`);
    text("#detailUnitPrice", product.unitPrice !== undefined ? money(product.unitPrice) : "기록 없음");
    text("#detailTotalPrice", order.totalPrice !== undefined ? money(order.totalPrice) : "기록 없음");
    text("#detailCreatedAt", date(order.createdAt));
    text("#detailAddress", [delivery.postalCode, delivery.address, delivery.addressDetail].filter(Boolean).join(" ") || order.address);
    const payment = await paymentState(user);
    text("#detailPayment", payment.label);
    if (
      payment.config?.checkoutEnabled
      && order.status === "confirmed"
      && (!payment.payment || ["ready", "cancelled"].includes(payment.payment.status))
    ) {
      $("#detailPayLink").href = `payment-checkout.html?orderId=${encodeURIComponent(orderId)}`;
      $("#detailPayLink").hidden = false;
    }
    text("#detailRecruitment", order.status === "new" ? "모집 진행 중" : "관리자 처리 상태 참조");
    text("#detailOrderStatus", statusLabels[order.status] || order.status);
    text("#detailDelivery", [order.carrier, order.trackingNumber].filter(Boolean).join(" · ") || (order.status === "shipping" ? "배송정보 확인 중" : "배송 전"));
    text("#detailAdminMemo", order.adminMemo || order.paymentGuide);
    text("#detailEditable", order.status === "new" ? "관리자 확인 전 취소·수정 가능 여부를 문의해 주세요." : "현재 화면에서는 취소·수정할 수 없습니다.");
    $("#orderDetailLoading").hidden = true;
    $("#orderDetail").hidden = false;
  } catch (error) {
    console.error(error);
    $("#orderDetailLoading").textContent = error.message || "신청내역을 불러오지 못했습니다.";
  }
});
