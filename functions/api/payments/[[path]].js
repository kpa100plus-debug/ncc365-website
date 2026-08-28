const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const TOSS_API_BASE = "https://api.tosspayments.com";
const TOSS_LIVE_CONFIRMATION = "NCC-TOSS-LIVE-CONFIRMED";
const TOSS_WIDGET_CLIENT_KEY = /^(test|live)_gck_[0-9A-Za-z_-]{8,}$/;
const TOSS_WIDGET_SECRET_KEY = /^(test|live)_gsk_[0-9A-Za-z_-]{8,}$/;

const PAYMENT_STATUSES = new Set([
  "ready",
  "paid",
  "partially_refunded",
  "refunded",
  "cancelled",
]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function apiError(status, code, message) {
  return json({ ok: false, code, message }, status);
}

function paymentRuntime(env) {
  const requestedProvider = String(env.PAYMENT_PROVIDER || "simulation").trim().toLowerCase();
  const requestedMode = String(env.TOSS_MODE || "disabled").trim().toLowerCase();
  const clientKey = String(env.TOSS_CLIENT_KEY || "").trim();
  const secretKey = String(env.TOSS_SECRET_KEY || "").trim();
  const clientMatch = clientKey.match(TOSS_WIDGET_CLIENT_KEY);
  const secretMatch = secretKey.match(TOSS_WIDGET_SECRET_KEY);
  const keyEnvironment = clientMatch?.[1] && clientMatch[1] === secretMatch?.[1]
    ? clientMatch[1]
    : null;
  const tossConfigured = requestedProvider === "toss"
    && new Set(["test", "live"]).has(requestedMode)
    && keyEnvironment === requestedMode;
  const liveConfirmed = requestedMode === "live"
    && env.PAYMENT_MODE === "live"
    && env.TOSS_LIVE_CONFIRMATION === TOSS_LIVE_CONFIRMATION;
  const realCharge = Boolean(tossConfigured && requestedMode === "live" && liveConfirmed);
  const tossEnabled = Boolean(tossConfigured && (requestedMode === "test" || realCharge));

  return {
    provider: tossEnabled ? "toss" : "simulation",
    mode: realCharge ? "live" : "test",
    tossMode: tossEnabled ? requestedMode : "disabled",
    tossConfigured,
    checkoutEnabled: tossEnabled,
    realCharge,
    clientKey: tossEnabled ? clientKey : "",
    secretKey: tossEnabled ? secretKey : "",
  };
}

function tossAuthorization(secretKey) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

async function boundedJson(response, limit = 256_000) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limit) throw new PaymentError(502, "PROVIDER_RESPONSE_TOO_LARGE", "결제사 응답 크기가 허용 범위를 초과했습니다.");
  const text = await response.text();
  if (text.length > limit) throw new PaymentError(502, "PROVIDER_RESPONSE_TOO_LARGE", "결제사 응답 크기가 허용 범위를 초과했습니다.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new PaymentError(502, "INVALID_PROVIDER_RESPONSE", "결제사 응답을 확인할 수 없습니다.");
  }
}

async function tossRequest(runtime, path, init = {}) {
  if (runtime.provider !== "toss" || !runtime.secretKey) {
    throw new PaymentError(503, "TOSS_NOT_CONFIGURED", "토스페이먼츠 연동 승인이 아직 완료되지 않았습니다.");
  }
  const response = await fetch(`${TOSS_API_BASE}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(8_000),
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
      authorization: tossAuthorization(runtime.secretKey),
      accept: "application/json",
    },
  });
  const body = await boundedJson(response);
  if (!response.ok) {
    const providerCode = String(body?.code || "TOSS_REQUEST_FAILED").slice(0, 80);
    console.error(JSON.stringify({ event: "toss_api_error", status: response.status, providerCode }));
    throw new PaymentError(
      response.status >= 500 ? 502 : 409,
      providerCode,
      "결제사 요청을 완료하지 못했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
  return body;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function paymentView(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    orderReceipt: row.order_receipt,
    amount: Number(row.amount),
    paidAmount: Number(row.paid_amount),
    refundedAmount: Number(row.refunded_amount),
    currency: row.currency,
    status: row.status,
    testMode: row.provider_environment ? row.provider_environment !== "live" : Boolean(row.test_mode),
    provider: row.provider || "simulation",
    providerEnvironment: row.provider_environment || "test",
    paymentMethod: row.payment_method || null,
    receiptUrl: row.receipt_url || null,
    approvedAt: row.approved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function adminPaymentView(row) {
  return { ...paymentView(row), memberEmail: row.member_email };
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "ncc365.com"
      || hostname === "www.ncc365.com"
      || hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname.endsWith(".ncc365-website.pages.dev");
  } catch {
    return false;
  }
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new PaymentError(415, "CONTENT_TYPE_REQUIRED", "JSON 요청만 허용됩니다.");
  }
  if (contentLength > 8192) {
    throw new PaymentError(413, "PAYLOAD_TOO_LARGE", "요청 데이터가 너무 큽니다.");
  }
  try {
    const body = await request.text();
    if (body.length > 8192) {
      throw new PaymentError(413, "PAYLOAD_TOO_LARGE", "요청 데이터가 너무 큽니다.");
    }
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(400, "INVALID_JSON", "요청 데이터를 확인해 주세요.");
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new PaymentError(401, "LOGIN_REQUIRED", "NCC 회원 로그인이 필요합니다.");
  return match[1];
}

function firebaseAccountAllowed(user, env, allowConfiguredAdmin = false) {
  if (!user?.localId || !user.email || user.disabled) return false;
  const email = String(user.email).toLowerCase();
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(user.emailVerified || (allowConfiguredAdmin && adminEmail && email === adminEmail));
}

async function verifyFirebaseUser(request, env, allowConfiguredAdmin = false) {
  const token = bearerToken(request);
  if (!env.FIREBASE_API_KEY) {
    throw new PaymentError(503, "AUTH_NOT_CONFIGURED", "결제 인증 설정이 완료되지 않았습니다.");
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!response.ok) {
    throw new PaymentError(401, "INVALID_LOGIN", "로그인 시간이 만료되었습니다. 다시 로그인해 주세요.");
  }
  const body = await response.json();
  const user = body.users?.[0];
  if (!firebaseAccountAllowed(user, env, allowConfiguredAdmin)) {
    throw new PaymentError(403, "ACCOUNT_NOT_ALLOWED", "인증된 활성 회원만 결제할 수 있습니다.");
  }
  return { uid: user.localId, email: String(user.email).toLowerCase(), token };
}

function requireAdmin(user, env) {
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!adminEmail || user.email !== adminEmail) {
    throw new PaymentError(403, "ADMIN_REQUIRED", "결제관리자 권한이 필요합니다.");
  }
}

function testPaymentUserAllowed(user, env) {
  if (!user?.email) return false;
  const email = String(user.email).trim().toLowerCase();
  const allowed = new Set(
    String(env.PAYMENT_TESTER_EMAILS || "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      .slice(0, 20),
  );
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail) allowed.add(adminEmail);
  return allowed.has(email);
}

function firestoreString(fields, key) {
  return String(fields?.[key]?.stringValue || "");
}

function firestoreInteger(fields, key) {
  const value = Number(fields?.[key]?.integerValue);
  return Number.isSafeInteger(value) ? value : NaN;
}

async function fetchAuthorizedOrder(orderId, user, env) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) {
    throw new PaymentError(400, "INVALID_ORDER", "주문번호를 확인해 주세요.");
  }
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID || "ncc-member")}/databases/(default)/documents/groupBuyOrders/${encodeURIComponent(orderId)}`;
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${user.token}` },
  });
  if (response.status === 404) {
    throw new PaymentError(404, "ORDER_NOT_FOUND", "주문을 찾을 수 없습니다.");
  }
  if (!response.ok) {
    throw new PaymentError(403, "ORDER_ACCESS_DENIED", "본인 주문만 결제할 수 있습니다.");
  }
  const document = await response.json();
  const fields = document.fields || {};
  const order = {
    id: orderId,
    receipt: firestoreString(fields, "receipt"),
    email: firestoreString(fields, "memberEmail").toLowerCase(),
    status: firestoreString(fields, "status"),
    amount: firestoreInteger(fields, "totalPrice"),
    title: firestoreString(fields, "productTitle"),
  };
  if (!order.receipt || order.email !== user.email) {
    throw new PaymentError(403, "ORDER_OWNER_MISMATCH", "주문 회원정보가 로그인 계정과 일치하지 않습니다.");
  }
  if (order.status !== "confirmed") {
    throw new PaymentError(409, "ORDER_NOT_CONFIRMED", "주문확정된 주문만 결제할 수 있습니다.");
  }
  if (!Number.isSafeInteger(order.amount) || order.amount < 100 || order.amount > 100_000_000) {
    throw new PaymentError(409, "INVALID_ORDER_AMOUNT", "주문 결제금액을 확인할 수 없습니다.");
  }
  return order;
}

function assertIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new PaymentError(400, "INVALID_IDEMPOTENCY_KEY", "중복결제 방지키를 확인해 주세요.");
  }
  return key;
}

function refundPlan(payment, requestedAmount) {
  if (!new Set(["paid", "partially_refunded"]).has(payment.status)) {
    throw new PaymentError(409, "PAYMENT_STATE_CONFLICT", "결제완료 또는 부분환불 상태에서만 환불할 수 있습니다.");
  }
  const paidAmount = Number(payment.paid_amount);
  const refundedAmount = Number(payment.refunded_amount);
  const available = paidAmount - refundedAmount;
  const amount = Number(requestedAmount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > available) {
    throw new PaymentError(400, "INVALID_REFUND_AMOUNT", `환불 가능금액은 1원부터 ${available}원까지입니다.`);
  }
  const nextRefunded = refundedAmount + amount;
  return {
    amount,
    available,
    nextRefunded,
    nextStatus: nextRefunded === paidAmount ? "refunded" : "partially_refunded",
  };
}

const PAYMENT_SELECT = `
  SELECT p.*,
    COALESCE(t.provider, 'simulation') AS provider,
    COALESCE(t.environment, 'test') AS provider_environment,
    t.provider_order_id,
    t.provider_payment_key,
    t.provider_status,
    t.method AS payment_method,
    t.receipt_url,
    t.approved_at,
    t.cancelled_at,
    t.last_synced_at
  FROM payments p
  LEFT JOIN payment_provider_transactions t ON t.payment_id = p.id`;

async function findPaymentById(env, paymentId) {
  try {
    return await env.NCC_PAYMENTS.prepare(`${PAYMENT_SELECT} WHERE p.id = ?1`)
      .bind(paymentId)
      .first();
  } catch (error) {
    if (!/no such table:\s*payment_provider_transactions/i.test(String(error?.message || error))) throw error;
    return env.NCC_PAYMENTS.prepare("SELECT * FROM payments WHERE id = ?1").bind(paymentId).first();
  }
}

function checkoutUrls(request, paymentId) {
  const origin = new URL(request.url).origin;
  const success = new URL("/payment-result.html", origin);
  const failure = new URL("/payment-result.html", origin);
  success.searchParams.set("paymentId", paymentId);
  success.searchParams.set("result", "success");
  failure.searchParams.set("paymentId", paymentId);
  failure.searchParams.set("result", "failure");
  return { successUrl: success.toString(), failUrl: failure.toString() };
}

async function ensureTossCheckout(request, env, runtime, payment, order, user) {
  if (!runtime.checkoutEnabled || payment.status !== "ready") return null;
  let transaction = await env.NCC_PAYMENTS.prepare(
    "SELECT * FROM payment_provider_transactions WHERE payment_id = ?1",
  ).bind(payment.id).first();
  if (transaction && transaction.environment !== runtime.tossMode) {
    throw new PaymentError(409, "PAYMENT_ENVIRONMENT_CONFLICT", "기존 결제환경과 현재 결제환경이 다릅니다. 관리자 확인이 필요합니다.");
  }
  if (!transaction) {
    const providerOrderId = `NCC_${payment.id.replaceAll("-", "")}`;
    const now = new Date().toISOString();
    await env.NCC_PAYMENTS.prepare(
      "INSERT OR IGNORE INTO payment_provider_transactions (payment_id, provider, environment, provider_order_id, provider_status, requested_at) VALUES (?1, 'toss', ?2, ?3, 'READY', ?4)",
    ).bind(payment.id, runtime.tossMode, providerOrderId, now).run();
    transaction = await env.NCC_PAYMENTS.prepare(
      "SELECT * FROM payment_provider_transactions WHERE payment_id = ?1",
    ).bind(payment.id).first();
  }
  if (!transaction) throw new PaymentError(500, "CHECKOUT_PREPARE_FAILED", "결제창 준비정보를 생성하지 못했습니다.");
  const customerHash = await sha256(user.uid);
  return {
    provider: "toss",
    mode: runtime.tossMode,
    clientKey: runtime.clientKey,
    customerKey: `ncc_${customerHash.slice(0, 32)}`,
    providerOrderId: transaction.provider_order_id,
    orderName: String(order.title || order.receipt || "NCC 공동구매").slice(0, 100),
    amount: Number(payment.amount),
    currency: "KRW",
    ...checkoutUrls(request, payment.id),
  };
}

async function findPaymentByProviderOrderId(env, providerOrderId) {
  return env.NCC_PAYMENTS.prepare(`${PAYMENT_SELECT} WHERE t.provider_order_id = ?1`)
    .bind(providerOrderId)
    .first();
}

function assertTossConfirmation(payment, body) {
  const providerOrderId = String(body.providerOrderId || body.orderId || "").trim();
  const paymentKey = String(body.paymentKey || "").trim();
  const amount = Number(body.amount);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(providerOrderId) || providerOrderId !== payment.provider_order_id) {
    throw new PaymentError(400, "PROVIDER_ORDER_MISMATCH", "결제 주문번호가 준비된 주문과 일치하지 않습니다.");
  }
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(paymentKey)) {
    throw new PaymentError(400, "INVALID_PAYMENT_KEY", "결제 인증정보를 확인해 주세요.");
  }
  if (!Number.isSafeInteger(amount) || amount !== Number(payment.amount)) {
    throw new PaymentError(400, "PAYMENT_AMOUNT_MISMATCH", "결제금액이 주문금액과 일치하지 않습니다.");
  }
  return { providerOrderId, paymentKey, amount };
}

function validateTossApprovedPayment(providerPayment, expected) {
  if (
    providerPayment?.paymentKey !== expected.paymentKey
    || providerPayment?.orderId !== expected.providerOrderId
    || Number(providerPayment?.totalAmount) !== expected.amount
    || providerPayment?.currency !== "KRW"
    || providerPayment?.status !== "DONE"
  ) {
    throw new PaymentError(502, "INVALID_TOSS_APPROVAL", "토스페이먼츠 승인결과가 주문정보와 일치하지 않습니다.");
  }
}

function providerRefundedAmount(providerPayment) {
  const totalAmount = Number(providerPayment?.totalAmount);
  const hasCancels = Array.isArray(providerPayment?.cancels) && providerPayment.cancels.length > 0;
  const cancelTotal = hasCancels
    ? providerPayment.cancels.reduce((sum, cancel) => sum + Number(cancel?.cancelAmount || 0), 0)
    : 0;
  const balanceAmount = Number(providerPayment?.balanceAmount);
  if (hasCancels && Number.isSafeInteger(cancelTotal) && cancelTotal >= 0) return cancelTotal;
  if (Number.isSafeInteger(totalAmount) && Number.isSafeInteger(balanceAmount)) {
    return Math.max(0, totalAmount - balanceAmount);
  }
  return 0;
}

function tossState(providerPayment, payment) {
  const providerStatus = String(providerPayment?.status || "").toUpperCase();
  const totalAmount = Number(providerPayment?.totalAmount);
  if (!Number.isSafeInteger(totalAmount) || totalAmount !== Number(payment.amount)) {
    throw new PaymentError(409, "PAYMENT_AMOUNT_MISMATCH", "결제사 금액과 주문금액이 일치하지 않습니다.");
  }
  if (providerPayment?.currency !== "KRW") {
    throw new PaymentError(409, "PAYMENT_CURRENCY_MISMATCH", "결제 통화가 원화와 일치하지 않습니다.");
  }
  if (providerStatus === "DONE") {
    return { providerStatus, status: "paid", paidAmount: totalAmount, refundedAmount: 0 };
  }
  if (providerStatus === "PARTIAL_CANCELED") {
    const refundedAmount = providerRefundedAmount(providerPayment);
    if (!Number.isSafeInteger(refundedAmount) || refundedAmount < 1 || refundedAmount >= totalAmount) {
      throw new PaymentError(502, "INVALID_TOSS_REFUND", "토스페이먼츠 부분취소 금액을 확인할 수 없습니다.");
    }
    return { providerStatus, status: "partially_refunded", paidAmount: totalAmount, refundedAmount };
  }
  if (providerStatus === "CANCELED") {
    return { providerStatus, status: "refunded", paidAmount: totalAmount, refundedAmount: totalAmount };
  }
  if (new Set(["ABORTED", "EXPIRED"]).has(providerStatus)) {
    return { providerStatus, status: "cancelled", paidAmount: 0, refundedAmount: 0 };
  }
  if (new Set(["READY", "IN_PROGRESS", "WAITING_FOR_DEPOSIT"]).has(providerStatus)) {
    return { providerStatus, status: "ready", paidAmount: 0, refundedAmount: 0 };
  }
  throw new PaymentError(502, "UNKNOWN_TOSS_STATUS", "토스페이먼츠 결제상태를 확인할 수 없습니다.");
}

function validateTossPaymentIdentity(providerPayment, payment, expectedPaymentKey = "") {
  if (
    !providerPayment?.paymentKey
    || providerPayment.orderId !== payment.provider_order_id
    || (expectedPaymentKey && providerPayment.paymentKey !== expectedPaymentKey)
    || (payment.provider_payment_key && providerPayment.paymentKey !== payment.provider_payment_key)
  ) {
    throw new PaymentError(409, "TOSS_PAYMENT_MISMATCH", "토스페이먼츠 결제정보가 준비된 주문과 일치하지 않습니다.");
  }
  return tossState(providerPayment, payment);
}

async function syncTossPayment(env, payment, providerPayment, event) {
  const state = validateTossPaymentIdentity(providerPayment, payment, event.expectedPaymentKey || "");
  const now = new Date().toISOString();
  const approvedAt = String(providerPayment.approvedAt || payment.approved_at || "").slice(0, 40) || null;
  const cancelledAt = String(
    providerPayment.cancels?.at(-1)?.canceledAt
      || (state.providerStatus === "CANCELED" ? now : payment.cancelled_at || ""),
  ).slice(0, 40) || null;
  const method = String(providerPayment.method || payment.payment_method || "").slice(0, 80) || null;
  const receiptUrl = String(providerPayment.receipt?.url || payment.receipt_url || "").slice(0, 500) || null;
  const eventKey = String(event.eventKey || "").slice(0, 240);
  if (!eventKey) throw new PaymentError(500, "PROVIDER_EVENT_KEY_REQUIRED", "결제 동기화 식별자를 생성하지 못했습니다.");

  const existingEvent = await env.NCC_PAYMENTS.prepare(
    "SELECT result FROM payment_provider_events WHERE event_key = ?1",
  ).bind(eventKey).first();
  if (existingEvent?.result === "processed") {
    return { payment: await findPaymentById(env, payment.id), reused: true };
  }

  const results = await env.NCC_PAYMENTS.batch([
    env.NCC_PAYMENTS.prepare(
      "UPDATE payments SET status = ?1, paid_amount = ?2, refunded_amount = ?3, updated_at = ?4 WHERE id = ?5",
    ).bind(state.status, state.paidAmount, state.refundedAmount, now, payment.id),
    env.NCC_PAYMENTS.prepare(
      "UPDATE payment_provider_transactions SET provider_payment_key = COALESCE(provider_payment_key, ?1), provider_status = ?2, method = ?3, receipt_url = ?4, approved_at = COALESCE(approved_at, ?5), cancelled_at = COALESCE(?6, cancelled_at), last_synced_at = ?7 WHERE payment_id = ?8 AND provider_order_id = ?9 AND (provider_payment_key IS NULL OR provider_payment_key = ?1)",
    ).bind(
      providerPayment.paymentKey,
      state.providerStatus,
      method,
      receiptUrl,
      approvedAt,
      cancelledAt,
      now,
      payment.id,
      payment.provider_order_id,
    ),
    env.NCC_PAYMENTS.prepare(
      "INSERT OR REPLACE INTO payment_provider_events (id, payment_id, provider, event_key, event_type, provider_status, amount, received_at, processed_at, result) VALUES (COALESCE((SELECT id FROM payment_provider_events WHERE event_key = ?1), ?2), ?3, 'toss', ?1, ?4, ?5, ?6, COALESCE((SELECT received_at FROM payment_provider_events WHERE event_key = ?1), ?7), ?7, 'processed')",
    ).bind(
      eventKey,
      crypto.randomUUID(),
      payment.id,
      String(event.eventType || "PAYMENT_STATUS_CHANGED").slice(0, 100),
      state.providerStatus,
      state.refundedAmount,
      now,
    ),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new PaymentError(409, "PAYMENT_RECORD_CONFLICT", "결제사 상태는 확인했으나 내부 기록을 다시 확인해야 합니다.");
  }
  return { payment: await findPaymentById(env, payment.id), reused: false };
}

async function preparePayment(request, env, user, runtime) {
  if (!runtime.realCharge && !testPaymentUserAllowed(user, env)) {
    throw new PaymentError(403, "TEST_PAYMENT_ACCESS_DENIED", "테스트 결제는 승인된 내부 계정만 사용할 수 있습니다.");
  }
  const body = await readJson(request);
  const order = await fetchAuthorizedOrder(String(body.orderId || ""), user, env);
  let existing = await env.NCC_PAYMENTS.prepare("SELECT * FROM payments WHERE order_id = ?1")
    .bind(order.id)
    .first();
  if (existing && !["cancelled"].includes(existing.status)) {
    const joined = await findPaymentById(env, existing.id);
    const checkout = await ensureTossCheckout(request, env, runtime, joined, order, user);
    return json({ ok: true, payment: paymentView(joined), checkout, reused: true });
  }

  const now = new Date().toISOString();
  if (existing?.status === "cancelled") {
    const operationKey = crypto.randomUUID();
    await env.NCC_PAYMENTS.batch([
      env.NCC_PAYMENTS.prepare(
        "UPDATE payments SET status = 'ready', amount = ?1, paid_amount = 0, refunded_amount = 0, idempotency_key = NULL, last_operation_key = ?2, member_uid = ?3, member_email = ?4, updated_at = ?5 WHERE id = ?6 AND status = 'cancelled'",
      ).bind(order.amount, operationKey, user.uid, user.email, now, existing.id),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'reopened', ?2, ?3, ?4, NULL, ?5 FROM payments WHERE id = ?6 AND last_operation_key = ?7 AND status = 'ready'",
      ).bind(crypto.randomUUID(), order.amount, user.uid, user.email, now, existing.id, operationKey),
    ]);
    existing = await findPaymentById(env, existing.id);
    const checkout = await ensureTossCheckout(request, env, runtime, existing, order, user);
    return json({ ok: true, payment: paymentView(existing), checkout, reused: true });
  }

  const paymentId = crypto.randomUUID();
  try {
    await env.NCC_PAYMENTS.batch([
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payments (id, order_id, order_receipt, member_uid, member_email, amount, paid_amount, refunded_amount, currency, status, test_mode, idempotency_key, last_operation_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 'KRW', 'ready', 1, NULL, NULL, ?7, ?7)",
      ).bind(paymentId, order.id, order.receipt, user.uid, user.email, order.amount, now),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) VALUES (?1, ?2, 'prepared', ?3, ?4, ?5, NULL, ?6)",
      ).bind(crypto.randomUUID(), paymentId, order.amount, user.uid, user.email, now),
    ]);
  } catch (error) {
    if (/UNIQUE|order_id/i.test(String(error?.message || error))) {
      const concurrent = await env.NCC_PAYMENTS.prepare("SELECT * FROM payments WHERE order_id = ?1")
        .bind(order.id)
        .first();
      if (concurrent) {
        const joined = await findPaymentById(env, concurrent.id);
        const checkout = await ensureTossCheckout(request, env, runtime, joined, order, user);
        return json({ ok: true, payment: paymentView(joined), checkout, reused: true });
      }
    }
    throw error;
  }
  const payment = await findPaymentById(env, paymentId);
  const checkout = await ensureTossCheckout(request, env, runtime, payment, order, user);
  return json({ ok: true, payment: paymentView(payment), checkout, reused: false }, 201);
}

async function confirmTossPayment(env, runtime, user, payment, body, idempotencyKey) {
  if (payment.provider !== "toss" || payment.provider_environment !== runtime.tossMode) {
    throw new PaymentError(409, "PAYMENT_ENVIRONMENT_CONFLICT", "준비된 결제환경과 현재 결제환경이 일치하지 않습니다.");
  }
  const expected = assertTossConfirmation(payment, body);
  if (
    payment.status === "paid"
    && payment.provider_payment_key === expected.paymentKey
  ) {
    return json({ ok: true, payment: paymentView(payment), reused: true });
  }
  if (payment.status !== "ready") {
    throw new PaymentError(409, "PAYMENT_STATE_CONFLICT", "현재 상태에서는 결제를 승인할 수 없습니다.");
  }
  const providerPayment = await tossRequest(runtime, "/v1/payments/confirm", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      paymentKey: expected.paymentKey,
      orderId: expected.providerOrderId,
      amount: expected.amount,
    }),
  });
  validateTossApprovedPayment(providerPayment, expected);
  const concurrentlySynced = await findPaymentById(env, payment.id);
  if (
    concurrentlySynced?.status === "paid"
    && concurrentlySynced.provider_payment_key === expected.paymentKey
  ) {
    return json({ ok: true, payment: paymentView(concurrentlySynced), reused: true });
  }

  const now = new Date().toISOString();
  const approvedAt = String(providerPayment.approvedAt || now).slice(0, 40);
  const method = String(providerPayment.method || "").slice(0, 80) || null;
  const receiptUrl = String(providerPayment.receipt?.url || "").slice(0, 500) || null;
  const providerEventKey = `confirm:${idempotencyKey}`;
  const results = await env.NCC_PAYMENTS.batch([
    env.NCC_PAYMENTS.prepare(
      "UPDATE payments SET status = 'paid', paid_amount = amount, idempotency_key = ?1, last_operation_key = ?1, updated_at = ?2 WHERE id = ?3 AND member_uid = ?4 AND status = 'ready'",
    ).bind(idempotencyKey, now, payment.id, user.uid),
    env.NCC_PAYMENTS.prepare(
      "UPDATE payment_provider_transactions SET provider_payment_key = COALESCE(provider_payment_key, ?1), provider_status = 'DONE', method = ?2, receipt_url = ?3, approved_at = ?4, last_synced_at = ?5 WHERE payment_id = ?6 AND provider_order_id = ?7 AND (provider_payment_key IS NULL OR provider_payment_key = ?1)",
    ).bind(expected.paymentKey, method, receiptUrl, approvedAt, now, payment.id, expected.providerOrderId),
    env.NCC_PAYMENTS.prepare(
      "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'paid', amount, ?2, ?3, ?4, ?5 FROM payments WHERE id = ?6 AND last_operation_key = ?4 AND status = 'paid'",
    ).bind(crypto.randomUUID(), user.uid, user.email, idempotencyKey, now, payment.id),
    env.NCC_PAYMENTS.prepare(
      "INSERT OR IGNORE INTO payment_provider_events (id, payment_id, provider, event_key, event_type, provider_status, amount, received_at, processed_at, result) VALUES (?1, ?2, 'toss', ?3, 'PAYMENT_CONFIRMED', 'DONE', ?4, ?5, ?5, 'processed')",
    ).bind(crypto.randomUUID(), payment.id, providerEventKey, expected.amount, now),
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1 || Number(results[1]?.meta?.changes || 0) !== 1) {
    throw new PaymentError(409, "PAYMENT_RECORD_CONFLICT", "결제는 승인되었으나 내부 기록을 다시 확인해야 합니다. 재결제하지 말고 관리자에게 문의해 주세요.");
  }
  return json({ ok: true, payment: paymentView(await findPaymentById(env, payment.id)), reused: false });
}

async function confirmPayment(request, env, user, runtime) {
  const body = await readJson(request);
  const paymentId = String(body.paymentId || "");
  const idempotencyKey = assertIdempotencyKey(body.idempotencyKey);
  const payment = await findPaymentById(env, paymentId);
  if (!payment || payment.member_uid !== user.uid) {
    throw new PaymentError(404, "PAYMENT_NOT_FOUND", "결제건을 찾을 수 없습니다.");
  }
  if (runtime.provider === "toss") {
    return confirmTossPayment(env, runtime, user, payment, body, idempotencyKey);
  }
  if (payment.status === "paid" && payment.idempotency_key === idempotencyKey) {
    return json({ ok: true, payment: paymentView(payment), reused: true });
  }
  if (payment.status !== "ready") {
    throw new PaymentError(409, "PAYMENT_STATE_CONFLICT", "현재 상태에서는 결제를 승인할 수 없습니다.");
  }
  if (body.simulateFailure === true) {
    await env.NCC_PAYMENTS.prepare(
      "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) VALUES (?1, ?2, 'failed_simulation', 0, ?3, ?4, ?5, ?6)",
    ).bind(crypto.randomUUID(), payment.id, user.uid, user.email, idempotencyKey, new Date().toISOString()).run();
    throw new PaymentError(402, "TEST_PAYMENT_FAILED", "요청한 테스트 결제실패가 정상 처리되었습니다.");
  }

  const now = new Date().toISOString();
  try {
    const results = await env.NCC_PAYMENTS.batch([
      env.NCC_PAYMENTS.prepare(
        "UPDATE payments SET status = 'paid', paid_amount = amount, idempotency_key = ?1, last_operation_key = ?1, updated_at = ?2 WHERE id = ?3 AND member_uid = ?4 AND status = 'ready'",
      ).bind(idempotencyKey, now, payment.id, user.uid),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'paid', amount, ?2, ?3, ?4, ?5 FROM payments WHERE id = ?6 AND last_operation_key = ?4 AND status = 'paid'",
      ).bind(crypto.randomUUID(), user.uid, user.email, idempotencyKey, now, payment.id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new PaymentError(409, "DUPLICATE_PAYMENT", "이미 처리 중이거나 완료된 결제입니다.");
    }
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if (/UNIQUE|idempotency/i.test(String(error?.message || error))) {
      throw new PaymentError(409, "DUPLICATE_PAYMENT", "같은 중복결제 방지키가 이미 사용되었습니다.");
    }
    throw error;
  }
  const confirmed = await findPaymentById(env, payment.id);
  return json({ ok: true, payment: paymentView(confirmed), reused: false });
}

async function memberPayments(env, user) {
  let result;
  try {
    result = await env.NCC_PAYMENTS.prepare(
      `${PAYMENT_SELECT} WHERE p.member_uid = ?1 ORDER BY p.created_at DESC LIMIT 100`,
    ).bind(user.uid).all();
  } catch (error) {
    if (!/no such table:\s*payment_provider_transactions/i.test(String(error?.message || error))) throw error;
    result = await env.NCC_PAYMENTS.prepare(
      "SELECT * FROM payments WHERE member_uid = ?1 ORDER BY created_at DESC LIMIT 100",
    ).bind(user.uid).all();
  }
  return json({ ok: true, payments: (result.results || []).map(paymentView) });
}

async function adminPayments(env, user) {
  let result;
  try {
    result = await env.NCC_PAYMENTS.prepare(`${PAYMENT_SELECT} ORDER BY p.created_at DESC LIMIT 200`).all();
  } catch (error) {
    if (!/no such table:\s*payment_provider_transactions/i.test(String(error?.message || error))) throw error;
    result = await env.NCC_PAYMENTS.prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT 200").all();
  }
  return json({ ok: true, payments: (result.results || []).map(adminPaymentView), admin: user.email });
}

async function cancelPayment(request, env, user) {
  const body = await readJson(request);
  const payment = await findPaymentById(env, String(body.paymentId || ""));
  if (!payment) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "결제건을 찾을 수 없습니다.");
  const key = assertIdempotencyKey(body.idempotencyKey);
  if (payment.status === "cancelled") {
    const event = await env.NCC_PAYMENTS.prepare(
      "SELECT payment_id, event_type FROM payment_events WHERE idempotency_key = ?1",
    ).bind(key).first();
    if (event?.payment_id === payment.id && event.event_type === "cancelled") {
      return json({ ok: true, payment: paymentView(payment), reused: true });
    }
  }
  if (payment.status !== "ready") {
    throw new PaymentError(409, "PAYMENT_STATE_CONFLICT", "승인 전 준비 상태의 결제만 취소할 수 있습니다.");
  }
  const now = new Date().toISOString();
  try {
    const results = await env.NCC_PAYMENTS.batch([
      env.NCC_PAYMENTS.prepare(
        "UPDATE payments SET status = 'cancelled', last_operation_key = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'ready'",
      ).bind(key, now, payment.id),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'cancelled', 0, ?2, ?3, ?4, ?5 FROM payments WHERE id = ?6 AND last_operation_key = ?4 AND status = 'cancelled'",
      ).bind(crypto.randomUUID(), user.uid, user.email, key, now, payment.id),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new PaymentError(409, "PAYMENT_STATE_CONFLICT", "결제 상태가 변경되어 취소하지 못했습니다.");
    }
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if (/UNIQUE|idempotency/i.test(String(error?.message || error))) {
      const event = await env.NCC_PAYMENTS.prepare(
        "SELECT payment_id, event_type FROM payment_events WHERE idempotency_key = ?1",
      ).bind(key).first();
      if (event?.payment_id === payment.id && event.event_type === "cancelled") {
        return json({ ok: true, payment: paymentView(await findPaymentById(env, payment.id)), reused: true });
      }
      throw new PaymentError(409, "IDEMPOTENCY_CONFLICT", "이미 다른 작업에 사용된 중복처리 방지키입니다.");
    }
    throw error;
  }
  return json({ ok: true, payment: paymentView(await findPaymentById(env, payment.id)) });
}

function assertRefundReason(value) {
  const reason = String(value || "고객 요청에 따른 NCC 관리자 환불").trim();
  if (reason.length < 2 || reason.length > 200) {
    throw new PaymentError(400, "INVALID_REFUND_REASON", "환불 사유는 2자 이상 200자 이하로 입력해 주세요.");
  }
  return reason;
}

async function refundPayment(request, env, user, runtime) {
  const body = await readJson(request);
  const payment = await findPaymentById(env, String(body.paymentId || ""));
  if (!payment) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "결제건을 찾을 수 없습니다.");
  const key = assertIdempotencyKey(body.idempotencyKey);
  const priorEvent = await env.NCC_PAYMENTS.prepare(
    "SELECT payment_id, event_type, amount FROM payment_events WHERE idempotency_key = ?1",
  ).bind(key).first();
  if (priorEvent) {
    if (priorEvent.payment_id === payment.id && priorEvent.event_type === "refunded" && Number(priorEvent.amount) === Number(body.amount)) {
      return json({ ok: true, payment: paymentView(payment), reused: true });
    }
    throw new PaymentError(409, "IDEMPOTENCY_CONFLICT", "이미 다른 작업에 사용된 중복처리 방지키입니다.");
  }
  const { amount, nextRefunded, nextStatus } = refundPlan(payment, body.amount);
  const reason = assertRefundReason(body.reason);
  let providerPayment = null;
  if (payment.provider === "toss") {
    if (runtime.provider !== "toss" || runtime.tossMode !== payment.provider_environment || !payment.provider_payment_key) {
      throw new PaymentError(503, "TOSS_REFUND_NOT_CONFIGURED", "이 결제환경의 토스페이먼츠 환불 설정을 확인해 주세요.");
    }
    providerPayment = await tossRequest(
      runtime,
      `/v1/payments/${encodeURIComponent(payment.provider_payment_key)}/cancel`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ cancelReason: reason, cancelAmount: amount }),
      },
    );
    const providerState = validateTossPaymentIdentity(providerPayment, payment, payment.provider_payment_key);
    if (
      providerState.status !== nextStatus
      || providerState.refundedAmount !== nextRefunded
      || providerState.paidAmount !== Number(payment.paid_amount)
    ) {
      throw new PaymentError(502, "INVALID_TOSS_REFUND", "토스페이먼츠 환불결과가 요청금액과 일치하지 않습니다.");
    }
  }
  const now = new Date().toISOString();
  try {
    const statements = [
      env.NCC_PAYMENTS.prepare(
        "UPDATE payments SET status = ?1, refunded_amount = ?2, last_operation_key = ?3, updated_at = ?4 WHERE id = ?5 AND refunded_amount = ?6 AND status IN ('paid', 'partially_refunded')",
      ).bind(nextStatus, nextRefunded, key, now, payment.id, Number(payment.refunded_amount)),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'refunded', ?2, ?3, ?4, ?5, ?6 FROM payments WHERE id = ?7 AND last_operation_key = ?5 AND refunded_amount = ?8",
      ).bind(crypto.randomUUID(), amount, user.uid, user.email, key, now, payment.id, nextRefunded),
    ];
    if (providerPayment) {
      const providerState = tossState(providerPayment, payment);
      statements.push(
        env.NCC_PAYMENTS.prepare(
          "UPDATE payment_provider_transactions SET provider_status = ?1, cancelled_at = ?2, last_synced_at = ?2 WHERE payment_id = ?3 AND provider_payment_key = ?4",
        ).bind(providerState.providerStatus, now, payment.id, payment.provider_payment_key),
        env.NCC_PAYMENTS.prepare(
          "INSERT OR IGNORE INTO payment_provider_events (id, payment_id, provider, event_key, event_type, provider_status, amount, details, received_at, processed_at, result) VALUES (?1, ?2, 'toss', ?3, 'PAYMENT_CANCELED', ?4, ?5, ?6, ?7, ?7, 'processed')",
        ).bind(
          crypto.randomUUID(),
          payment.id,
          `refund:${key}`,
          providerState.providerStatus,
          amount,
          JSON.stringify({ reason }),
          now,
        ),
      );
    }
    const results = await env.NCC_PAYMENTS.batch(statements);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      throw new PaymentError(409, "REFUND_CONFLICT", "다른 환불이 먼저 처리되어 다시 확인해야 합니다.");
    }
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if (/UNIQUE|idempotency/i.test(String(error?.message || error))) {
      const event = await env.NCC_PAYMENTS.prepare(
        "SELECT payment_id, event_type, amount FROM payment_events WHERE idempotency_key = ?1",
      ).bind(key).first();
      if (event?.payment_id === payment.id && event.event_type === "refunded" && Number(event.amount) === amount) {
        const current = await findPaymentById(env, payment.id);
        return json({ ok: true, payment: paymentView(current), reused: true });
      }
      throw new PaymentError(409, "IDEMPOTENCY_CONFLICT", "이미 다른 환불에 사용된 중복처리 방지키입니다.");
    }
    throw error;
  }
  return json({ ok: true, payment: paymentView(await findPaymentById(env, payment.id)), reused: false });
}

async function tossPaymentByKey(runtime, paymentKey) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(paymentKey)) {
    throw new PaymentError(400, "INVALID_PAYMENT_KEY", "결제 인증정보를 확인해 주세요.");
  }
  return tossRequest(runtime, `/v1/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" });
}

async function reconcileTossPayment(request, env, user, runtime) {
  const body = await readJson(request);
  const key = assertIdempotencyKey(body.idempotencyKey);
  const payment = await findPaymentById(env, String(body.paymentId || ""));
  if (!payment) throw new PaymentError(404, "PAYMENT_NOT_FOUND", "결제건을 찾을 수 없습니다.");
  if (payment.provider !== "toss" || !payment.provider_payment_key) {
    throw new PaymentError(409, "TOSS_PAYMENT_NOT_READY", "토스페이먼츠 승인정보가 있는 결제만 동기화할 수 있습니다.");
  }
  if (runtime.provider !== "toss" || runtime.tossMode !== payment.provider_environment) {
    throw new PaymentError(503, "TOSS_NOT_CONFIGURED", "이 결제환경의 토스페이먼츠 설정을 확인해 주세요.");
  }
  const providerPayment = await tossPaymentByKey(runtime, payment.provider_payment_key);
  const synced = await syncTossPayment(env, payment, providerPayment, {
    eventKey: `reconcile:${key}`,
    eventType: "ADMIN_RECONCILED",
    expectedPaymentKey: payment.provider_payment_key,
  });
  return json({ ok: true, payment: paymentView(synced.payment), reused: synced.reused, admin: user.email });
}

async function handleTossWebhook(request, env, runtime) {
  if (!env.NCC_PAYMENTS || runtime.provider !== "toss") {
    return apiError(503, "TOSS_NOT_CONFIGURED", "토스페이먼츠 웹훅을 처리할 준비가 되지 않았습니다.");
  }
  const body = await readJson(request);
  const data = body?.data && typeof body.data === "object" ? body.data : body;
  const providerOrderId = String(data?.orderId || "").trim();
  const paymentKey = String(data?.paymentKey || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(providerOrderId) || !/^[A-Za-z0-9_-]{10,200}$/.test(paymentKey)) {
    return json({ ok: true, processed: false });
  }
  const payment = await findPaymentByProviderOrderId(env, providerOrderId);
  if (!payment || payment.provider !== "toss") return json({ ok: true, processed: false });
  if (runtime.tossMode !== payment.provider_environment) return json({ ok: true, processed: false });
  if (payment.provider_payment_key && payment.provider_payment_key !== paymentKey) {
    return json({ ok: true, processed: false });
  }
  const providerPayment = await tossPaymentByKey(runtime, paymentKey);
  const eventDigest = await sha256([
    String(body?.eventType || "PAYMENT_STATUS_CHANGED"),
    providerOrderId,
    paymentKey,
    String(body?.createdAt || data?.requestedAt || data?.approvedAt || providerPayment?.status || ""),
  ].join(":"));
  const synced = await syncTossPayment(env, payment, providerPayment, {
    eventKey: `webhook:${eventDigest}`,
    eventType: String(body?.eventType || "PAYMENT_STATUS_CHANGED"),
    expectedPaymentKey: paymentKey,
  });
  return json({ ok: true, processed: true, reused: synced.reused });
}

class PaymentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!allowedOrigin(request)) return apiError(403, "ORIGIN_DENIED", "허용되지 않은 요청 출처입니다.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/payments\/?/, "").replace(/\/$/, "");
  const runtime = paymentRuntime(env);
  if (request.method === "GET" && route === "config") {
    const enabled = Boolean(
      env.NCC_PAYMENTS
      && env.FIREBASE_API_KEY
      && env.ADMIN_EMAIL
      && (env.PAYMENT_MODE === "test" || runtime.realCharge),
    );
    let checkoutEnabled = Boolean(enabled && runtime.realCharge);
    if (enabled && runtime.tossMode === "test" && request.headers.get("authorization")) {
      try {
        const user = await verifyFirebaseUser(request, env);
        checkoutEnabled = testPaymentUserAllowed(user, env);
      } catch {
        checkoutEnabled = false;
      }
    }
    return json({
      ok: true,
      enabled,
      provider: runtime.provider,
      checkoutEnabled,
      tossConfigured: runtime.tossConfigured,
      mode: runtime.mode,
      realCharge: runtime.realCharge,
      notice: runtime.realCharge
        ? "토스페이먼츠 운영 결제가 활성화되어 있습니다."
        : "실제 카드승인·계좌이체·금전이동은 비활성 상태입니다.",
      auditVersion: "2026-08-28-toss-prebuild",
    });
  }
  if (!env.NCC_PAYMENTS) return apiError(503, "DATABASE_NOT_BOUND", "결제 데이터베이스 연결이 필요합니다.");
  if (request.method === "POST" && route === "webhook/toss") {
    try {
      return await handleTossWebhook(request, env, runtime);
    } catch (error) {
      if (error instanceof PaymentError) return apiError(error.status, error.code, error.message);
      console.error(JSON.stringify({ event: "toss_webhook_error", message: String(error?.message || error).slice(0, 200) }));
      return apiError(500, "TOSS_WEBHOOK_ERROR", "토스페이먼츠 웹훅을 처리하지 못했습니다.");
    }
  }
  if (env.PAYMENT_MODE !== "test" && !runtime.realCharge) {
    return apiError(503, "PAYMENT_MODE_DISABLED", "결제모드가 안전 잠금 상태입니다.");
  }
  if (!new Set(["GET", "POST"]).has(request.method)) {
    return apiError(405, "METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.");
  }

  try {
    const user = await verifyFirebaseUser(request, env, route.startsWith("admin/"));
    if (request.method === "GET" && route === "me") return await memberPayments(env, user);
    if (request.method === "POST" && route === "prepare") return await preparePayment(request, env, user, runtime);
    if (request.method === "POST" && route === "confirm") return await confirmPayment(request, env, user, runtime);
    if (route.startsWith("admin/")) requireAdmin(user, env);
    if (request.method === "GET" && route === "admin/list") return await adminPayments(env, user);
    if (request.method === "POST" && route === "admin/cancel") return await cancelPayment(request, env, user);
    if (request.method === "POST" && route === "admin/refund") return await refundPayment(request, env, user, runtime);
    if (request.method === "POST" && route === "admin/reconcile") return await reconcileTossPayment(request, env, user, runtime);
    return apiError(404, "NOT_FOUND", "요청한 결제 기능을 찾을 수 없습니다.");
  } catch (error) {
    if (error instanceof PaymentError) return apiError(error.status, error.code, error.message);
    console.error(JSON.stringify({ event: "payment_api_error", route, message: String(error?.message || error).slice(0, 300) }));
    return apiError(500, "PAYMENT_SERVER_ERROR", "결제 처리 중 오류가 발생했습니다.");
  }
}

export const __test = {
  adminPaymentView,
  allowedOrigin,
  assertIdempotencyKey,
  assertRefundReason,
  assertTossConfirmation,
  firestoreInteger,
  firestoreString,
  firebaseAccountAllowed,
  paymentRuntime,
  paymentView,
  providerRefundedAmount,
  refundPlan,
  tossAuthorization,
  testPaymentUserAllowed,
  tossState,
  validateTossApprovedPayment,
  validateTossPaymentIdentity,
  PAYMENT_STATUSES,
};
