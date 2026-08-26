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
    member_uid: "must-not-leak"
  });
  assert.equal(view.orderId, "order-1");
  assert.equal(view.testMode, true);
  assert.equal("idempotencyKey" in view, false);
  assert.equal("memberUid" in view, false);
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
