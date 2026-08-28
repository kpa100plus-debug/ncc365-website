import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, __test } from "../functions/api/payments/[[path]].js";

test("payment API accepts only approved NCC origins", () => {
  assert.equal(__test.allowedOrigin(new Request("https://ncc365.com/api/payments/config")), true);
  assert.equal(__test.allowedOrigin(new Request("https://ncc365.com/api/payments/config", { headers: { origin: "https://ncc365.com" } })), true);
  assert.equal(__test.allowedOrigin(new Request("https://ncc365.com/api/payments/config", { headers: { origin: "https://codex-test.ncc365-website.pages.dev" } })), true);
  assert.equal(__test.allowedOrigin(new Request("https://ncc365.com/api/payments/config", { headers: { origin: "https://example.com" } })), false);
});

test("idempotency keys require unpredictable identifier length and characters", () => {
  assert.equal(__test.assertIdempotencyKey("ncc_0123456789abcdef"), "ncc_0123456789abcdef");
  assert.throws(() => __test.assertIdempotencyKey("short"));
  assert.throws(() => __test.assertIdempotencyKey("invalid key with spaces"));
});

test("Firestore typed fields are parsed without trusting loose values", () => {
  const fields = {
    receipt: { stringValue: "NCC-G-260826-12345" },
    totalPrice: { integerValue: "25000" },
    malformed: { integerValue: "25000.5" }
  };
  assert.equal(__test.firestoreString(fields, "receipt"), "NCC-G-260826-12345");
  assert.equal(__test.firestoreInteger(fields, "totalPrice"), 25000);
  assert.ok(Number.isNaN(__test.firestoreInteger(fields, "malformed")));
});

test("payment view exposes no authentication token or internal idempotency key", () => {
  const view = __test.paymentView({
    id: "payment-1",
    order_id: "order-1",
    order_receipt: "NCC-G-260826-12345",
    amount: 25000,
    paid_amount: 25000,
    refunded_amount: 0,
    currency: "KRW",
    status: "paid",
    test_mode: 1,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z",
    idempotency_key: "must-not-leak",
    member_uid: "must-not-leak",
    provider_payment_key: "must-not-leak",
  });
  assert.equal(view.orderId, "order-1");
  assert.equal(view.testMode, true);
  assert.equal("idempotencyKey" in view, false);
  assert.equal("memberUid" in view, false);
  assert.equal("providerPaymentKey" in view, false);
  assert.equal(__test.paymentView({ ...view, provider_environment: "live", test_mode: 1 }).testMode, false);
});

test("payment runtime keeps Toss locked until provider, mode, and paired keys agree", () => {
  assert.deepEqual(__test.paymentRuntime({}), {
    provider: "simulation",
    mode: "test",
    tossMode: "disabled",
    tossConfigured: false,
    checkoutEnabled: false,
    realCharge: false,
    clientKey: "",
    secretKey: "",
  });
  const testRuntime = __test.paymentRuntime({
    PAYMENT_MODE: "test",
    PAYMENT_PROVIDER: "toss",
    TOSS_MODE: "test",
    TOSS_CLIENT_KEY: "test_gck_abcdefgh",
    TOSS_SECRET_KEY: "test_gsk_abcdefgh",
  });
  assert.equal(testRuntime.provider, "toss");
  assert.equal(testRuntime.checkoutEnabled, true);
  assert.equal(testRuntime.realCharge, false);
  assert.equal(testRuntime.mode, "test");
  assert.equal(__test.paymentRuntime({
    PAYMENT_PROVIDER: "toss",
    TOSS_MODE: "test",
    TOSS_CLIENT_KEY: "test_gck_abcdefgh",
    TOSS_SECRET_KEY: "live_gsk_abcdefgh",
  }).checkoutEnabled, false);
});

test("live Toss runtime needs all independent activation guards", () => {
  const base = {
    PAYMENT_PROVIDER: "toss",
    TOSS_MODE: "live",
    TOSS_CLIENT_KEY: "live_gck_abcdefgh",
    TOSS_SECRET_KEY: "live_gsk_abcdefgh",
  };
  assert.equal(__test.paymentRuntime(base).realCharge, false);
  assert.equal(__test.paymentRuntime({ ...base, PAYMENT_MODE: "live" }).realCharge, false);
  const active = __test.paymentRuntime({
    ...base,
    PAYMENT_MODE: "live",
    TOSS_LIVE_CONFIRMATION: "NCC-TOSS-LIVE-CONFIRMED",
  });
  assert.equal(active.provider, "toss");
  assert.equal(active.mode, "live");
  assert.equal(active.realCharge, true);
});

test("Toss confirmation validates payment key, provider order, and exact amount", () => {
  const payment = { provider_order_id: "NCC_0123456789", amount: 25000 };
  assert.deepEqual(__test.assertTossConfirmation(payment, {
    paymentKey: "payment_key_123456",
    orderId: "NCC_0123456789",
    amount: 25000,
  }), {
    paymentKey: "payment_key_123456",
    providerOrderId: "NCC_0123456789",
    amount: 25000,
  });
  assert.throws(() => __test.assertTossConfirmation(payment, {
    paymentKey: "payment_key_123456",
    orderId: "NCC_other",
    amount: 25000,
  }));
  assert.throws(() => __test.assertTossConfirmation(payment, {
    paymentKey: "payment_key_123456",
    orderId: "NCC_0123456789",
    amount: 24999,
  }));
});

test("Toss states map paid, partial refund, and full refund without guessing", () => {
  const payment = { amount: 25000, provider_order_id: "NCC_0123456789", provider_payment_key: "payment_key_123456" };
  const identity = { paymentKey: "payment_key_123456", orderId: "NCC_0123456789", currency: "KRW", totalAmount: 25000 };
  assert.equal(__test.tossState({ ...identity, status: "DONE" }, payment).status, "paid");
  assert.deepEqual(__test.tossState({
    ...identity,
    status: "PARTIAL_CANCELED",
    cancels: [{ cancelAmount: 10000 }],
  }, payment), {
    providerStatus: "PARTIAL_CANCELED",
    status: "partially_refunded",
    paidAmount: 25000,
    refundedAmount: 10000,
  });
  assert.equal(__test.tossState({ ...identity, status: "CANCELED" }, payment).status, "refunded");
  assert.throws(() => __test.tossState({ ...identity, totalAmount: 1, status: "DONE" }, payment));
});

test("Toss Basic authorization has no accidental credential suffix or plaintext response leak", () => {
  const authorization = __test.tossAuthorization("test_gsk_abcdefgh");
  assert.match(authorization, /^Basic [A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(authorization.slice(6), "base64").toString(), "test_gsk_abcdefgh:");
});

test("refund reason is bounded", () => {
  assert.equal(__test.assertRefundReason("고객 요청 환불"), "고객 요청 환불");
  assert.throws(() => __test.assertRefundReason("한"));
  assert.throws(() => __test.assertRefundReason("가".repeat(201)));
});

test("member email is added only to the administrator payment view", () => {
  const row = {
    id: "payment-1",
    order_id: "order-1",
    order_receipt: "NCC-G-260826-12345",
    member_email: "member@example.com",
    amount: 25000,
    paid_amount: 25000,
    refunded_amount: 0,
    currency: "KRW",
    status: "paid",
    test_mode: 1,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z"
  };
  assert.equal("memberEmail" in __test.paymentView(row), false);
  assert.equal(__test.adminPaymentView(row).memberEmail, "member@example.com");
});

test("refund plan enforces partial and full refund boundaries", () => {
  const payment = { status: "paid", paid_amount: 25000, refunded_amount: 0 };
  assert.deepEqual(__test.refundPlan(payment, 10000), {
    amount: 10000,
    available: 25000,
    nextRefunded: 10000,
    nextStatus: "partially_refunded"
  });
  assert.equal(__test.refundPlan(payment, 25000).nextStatus, "refunded");
  assert.throws(() => __test.refundPlan(payment, 25001));
  assert.throws(() => __test.refundPlan({ ...payment, status: "ready" }, 1000));
});

test("config endpoint remains disabled until D1 and required variables are bound", async () => {
  const response = await onRequest({
    request: new Request("https://ncc365.com/api/payments/config"),
    env: {}
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false);
  assert.equal(body.realCharge, false);
});

test("public config keeps Toss test checkout private and never exposes keys", async () => {
  const response = await onRequest({
    request: new Request("https://ncc365.com/api/payments/config"),
    env: {
      NCC_PAYMENTS: {},
      FIREBASE_API_KEY: "public-firebase-key",
      ADMIN_EMAIL: "admin@example.com",
      PAYMENT_MODE: "test",
      PAYMENT_PROVIDER: "toss",
      TOSS_MODE: "test",
      TOSS_CLIENT_KEY: "test_gck_abcdefgh",
      TOSS_SECRET_KEY: "test_gsk_abcdefgh",
      PAYMENT_TESTER_EMAILS: "tester@example.com",
    }
  });
  const body = await response.json();
  assert.equal(body.enabled, true);
  assert.equal(body.provider, "toss");
  assert.equal(body.checkoutEnabled, false);
  assert.equal(body.realCharge, false);
  assert.equal("clientKey" in body, false);
  assert.equal("secretKey" in body, false);
});

test("Toss test checkout allowlist accepts only configured internal accounts and the administrator", () => {
  const env = { PAYMENT_TESTER_EMAILS: "Tester@example.com, second@example.com", ADMIN_EMAIL: "admin@example.com" };
  assert.equal(__test.testPaymentUserAllowed({ email: "tester@example.com" }, env), true);
  assert.equal(__test.testPaymentUserAllowed({ email: "ADMIN@example.com" }, env), true);
  assert.equal(__test.testPaymentUserAllowed({ email: "public@example.com" }, env), false);
  assert.equal(__test.testPaymentUserAllowed({}, env), false);
});

test("authenticated internal tester can discover the test checkout without exposing a key", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /identitytoolkit\.googleapis\.com/);
    return new Response(JSON.stringify({ users: [{ localId: "tester-uid", email: "tester@example.com", emailVerified: true }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await onRequest({
      request: new Request("https://ncc365.com/api/payments/config", { headers: { authorization: "Bearer valid-test-token" } }),
      env: {
        NCC_PAYMENTS: {},
        FIREBASE_API_KEY: "public-firebase-key",
        ADMIN_EMAIL: "admin@example.com",
        PAYMENT_MODE: "test",
        PAYMENT_PROVIDER: "toss",
        TOSS_MODE: "test",
        TOSS_CLIENT_KEY: "test_gck_abcdefgh",
        TOSS_SECRET_KEY: "test_gsk_abcdefgh",
        PAYMENT_TESTER_EMAILS: "tester@example.com",
      },
    });
    const body = await response.json();
    assert.equal(body.checkoutEnabled, true);
    assert.equal("clientKey" in body, false);
    assert.equal("secretKey" in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unapproved origins are rejected before any payment work", async () => {
  const response = await onRequest({
    request: new Request("https://ncc365.com/api/payments/config", { headers: { origin: "https://example.com" } }),
    env: {}
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ORIGIN_DENIED");
});

test("only the configured administrator may bypass email verification on administrator routes", () => {
  const env = { ADMIN_EMAIL: "admin@example.com" };
  const admin = { localId: "admin-uid", email: "ADMIN@example.com", disabled: false, emailVerified: false };
  const member = { localId: "member-uid", email: "member@example.com", disabled: false, emailVerified: false };
  assert.equal(__test.firebaseAccountAllowed(admin, env, true), true);
  assert.equal(__test.firebaseAccountAllowed(admin, env, false), false);
  assert.equal(__test.firebaseAccountAllowed(member, env, true), false);
  assert.equal(__test.firebaseAccountAllowed({ ...admin, disabled: true }, env, true), false);
});
