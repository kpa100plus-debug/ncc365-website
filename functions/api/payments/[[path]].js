const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

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
    testMode: Boolean(row.test_mode),
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
    return await request.json();
  } catch {
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

async function findPaymentById(env, paymentId) {
  return env.NCC_PAYMENTS.prepare("SELECT * FROM payments WHERE id = ?1")
    .bind(paymentId)
    .first();
}

async function preparePayment(request, env, user) {
  const body = await readJson(request);
  const order = await fetchAuthorizedOrder(String(body.orderId || ""), user, env);
  let existing = await env.NCC_PAYMENTS.prepare("SELECT * FROM payments WHERE order_id = ?1")
    .bind(order.id)
    .first();
  if (existing && !["cancelled"].includes(existing.status)) {
    return json({ ok: true, payment: paymentView(existing), reused: true });
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
    return json({ ok: true, payment: paymentView(existing), reused: true });
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
      if (concurrent) return json({ ok: true, payment: paymentView(concurrent), reused: true });
    }
    throw error;
  }
  const payment = await findPaymentById(env, paymentId);
  return json({ ok: true, payment: paymentView(payment), reused: false }, 201);
}

async function confirmPayment(request, env, user) {
  const body = await readJson(request);
  const paymentId = String(body.paymentId || "");
  const idempotencyKey = assertIdempotencyKey(body.idempotencyKey);
  const payment = await findPaymentById(env, paymentId);
  if (!payment || payment.member_uid !== user.uid) {
    throw new PaymentError(404, "PAYMENT_NOT_FOUND", "결제건을 찾을 수 없습니다.");
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
  const result = await env.NCC_PAYMENTS.prepare(
    "SELECT * FROM payments WHERE member_uid = ?1 ORDER BY created_at DESC LIMIT 100",
  ).bind(user.uid).all();
  return json({ ok: true, payments: (result.results || []).map(paymentView) });
}

async function adminPayments(env, user) {
  const result = await env.NCC_PAYMENTS.prepare(
    "SELECT * FROM payments ORDER BY created_at DESC LIMIT 200",
  ).all();
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

async function refundPayment(request, env, user) {
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
  const now = new Date().toISOString();
  try {
    const results = await env.NCC_PAYMENTS.batch([
      env.NCC_PAYMENTS.prepare(
        "UPDATE payments SET status = ?1, refunded_amount = ?2, last_operation_key = ?3, updated_at = ?4 WHERE id = ?5 AND refunded_amount = ?6 AND status IN ('paid', 'partially_refunded')",
      ).bind(nextStatus, nextRefunded, key, now, payment.id, Number(payment.refunded_amount)),
      env.NCC_PAYMENTS.prepare(
        "INSERT INTO payment_events (id, payment_id, event_type, amount, actor_uid, actor_email, idempotency_key, created_at) SELECT ?1, id, 'refunded', ?2, ?3, ?4, ?5, ?6 FROM payments WHERE id = ?7 AND last_operation_key = ?5 AND refunded_amount = ?8",
      ).bind(crypto.randomUUID(), amount, user.uid, user.email, key, now, payment.id, nextRefunded),
    ]);
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
  if (request.method === "GET" && route === "config") {
    const enabled = Boolean(env.NCC_PAYMENTS && env.FIREBASE_API_KEY && env.ADMIN_EMAIL && env.PAYMENT_MODE === "test");
    return json({
      ok: true,
      enabled,
      mode: "test",
      realCharge: false,
      notice: "테스트 결제는 실제 카드승인·계좌이체·금전이동이 발생하지 않습니다.",
      auditVersion: "2026-08-26-admin-route-auth",
    });
  }
  if (env.PAYMENT_MODE !== "test") return apiError(503, "TEST_MODE_DISABLED", "테스트 결제모드가 비활성화되어 있습니다.");
  if (!env.NCC_PAYMENTS) return apiError(503, "DATABASE_NOT_BOUND", "결제 데이터베이스 연결이 필요합니다.");
  if (!new Set(["GET", "POST"]).has(request.method)) {
    return apiError(405, "METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.");
  }

  try {
    const user = await verifyFirebaseUser(request, env, route.startsWith("admin/"));
    if (request.method === "GET" && route === "me") return await memberPayments(env, user);
    if (request.method === "POST" && route === "prepare") return await preparePayment(request, env, user);
    if (request.method === "POST" && route === "confirm") return await confirmPayment(request, env, user);
    if (route.startsWith("admin/")) requireAdmin(user, env);
    if (request.method === "GET" && route === "admin/list") return await adminPayments(env, user);
    if (request.method === "POST" && route === "admin/cancel") return await cancelPayment(request, env, user);
    if (request.method === "POST" && route === "admin/refund") return await refundPayment(request, env, user);
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
  firestoreInteger,
  firestoreString,
  firebaseAccountAllowed,
  paymentView,
  refundPlan,
  PAYMENT_STATUSES,
};
