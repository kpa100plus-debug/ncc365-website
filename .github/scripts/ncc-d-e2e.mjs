import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const config = {
  baseUrl: process.env.NCC_BASE_URL || "https://ncc365.com",
  memberEmail: process.env.NCC_E2E_D_EMAIL || "",
  memberPassword: process.env.NCC_E2E_D_PASSWORD || "",
  adminEmail: process.env.NCC_E2E_ADMIN_EMAIL || "",
  adminPassword: process.env.NCC_E2E_ADMIN_PASSWORD || "",
  memberNumber: process.env.NCC_E2E_D_MEMBER_NUMBER || "",
  memberName: process.env.NCC_E2E_D_MEMBER_NAME || "",
  runId: process.env.NCC_E2E_RUN_ID || `local-${Date.now()}`,
};

const EXPECTED_MEMBER_NUMBER = "NCC-C-000016";
const secrets = [
  config.memberEmail,
  config.memberPassword,
  config.adminEmail,
  config.adminPassword,
].filter(Boolean);

const result = {
  referenceCode: "REF-NCC-WEBSITE-PERFECT-AUDIT-14",
  safetyReferenceCode: "REF-NCC-CI-E2E-AUTH-SETUP-01",
  runId: config.runId,
  memberNumber: config.memberNumber,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "running",
  checks: {
    memberIdentityMatched: false,
    walletLoaded: false,
    consumerNavAuthenticated: false,
    benefitDetailLoaded: false,
    myPageLoaded: false,
    deliveryAddressSaved: false,
    groupBuyAddressPrefilled: false,
    groupBuyOrderSubmitted: false,
    groupBuyOrderConfirmed: false,
    testPaymentConfigSafe: false,
    testPaymentPrepared: false,
    testPaymentPrepareReused: false,
    testPaymentConfirmed: false,
    testPaymentDuplicatePrevented: false,
    testPaymentPartiallyRefunded: false,
    testPaymentFullyRefunded: false,
    testPaymentMemberHistoryVerified: false,
    testPaymentDataRemoved: false,
    groupBuyPaymentConfirmed: false,
    groupBuyOrderShipping: false,
    groupBuyOrderCompleted: false,
    memberOrderTrackingVerified: false,
    expectationCreated: false,
    expectationLiked: false,
    duplicateLikePrevented: false,
    feedbackReported: false,
    verifiedReviewCreated: false,
    feedbackAdminStatusSaved: false,
    feedbackDataRemoved: false,
    groupBuyOrderCancelled: false,
    groupBuyOrderRemoved: false,
    deliveryAddressRemoved: false,
    memberInfoTemporarilyChanged: false,
    memberInfoRestored: false,
    withdrawalRequested: false,
    withdrawalRejected: false,
    rejectionLogVerified: false,
    finalLoginSucceeded: false,
    finalStatusActive: false,
  },
  safety: {
    accountDeletionAttempted: false,
    passwordChanged: false,
    emailChanged: false,
    screenshotsCaptured: false,
    tracesCaptured: false,
  },
};

function redact(value) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text.slice(0, 1500);
}

function requireConfig() {
  const missing = [];
  for (const [name, value] of Object.entries({
    NCC_E2E_D_EMAIL: config.memberEmail,
    NCC_E2E_D_PASSWORD: config.memberPassword,
    NCC_E2E_ADMIN_EMAIL: config.adminEmail,
    NCC_E2E_ADMIN_PASSWORD: config.adminPassword,
    NCC_E2E_D_MEMBER_NUMBER: config.memberNumber,
    NCC_E2E_D_MEMBER_NAME: config.memberName,
  })) {
    if (!value) missing.push(name);
  }
  if (missing.length) {
    throw new Error(`Missing required environment configuration: ${missing.join(", ")}`);
  }
  if (config.memberNumber !== EXPECTED_MEMBER_NUMBER) {
    throw new Error("Safety stop: the configured member number is not the approved test member D.");
  }
  if (!config.baseUrl.startsWith("https://ncc365.com")) {
    throw new Error("Safety stop: the target is not the approved NCC production origin.");
  }
}

function stage(message) {
  console.log(`[NCC E2E] ${message}`);
}

async function goto(page, path) {
  await page.goto(`${config.baseUrl}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function loginMember(page) {
  await goto(page, "/wallet.html");
  await page.locator("#loginForm").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('#loginForm input[name="email"]').fill(config.memberEmail);
  await page.locator('#loginForm input[name="password"]').fill(config.memberPassword);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.locator("#memberArea").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#memberNumber").waitFor({ state: "visible", timeout: 30_000 });

  const number = (await page.locator("#memberNumber").textContent())?.trim();
  const storedProfile = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem("nccMemberProfile") || "null");
    } catch {
      return null;
    }
  });
  const storedNumber = String(storedProfile?.memberNumber || "").trim();
  const storedName = String(storedProfile?.name || "").trim();
  if (
    number !== config.memberNumber ||
    storedNumber !== config.memberNumber ||
    !storedName.includes(config.memberName)
  ) {
    throw new Error("Safety stop: the signed-in account does not match approved test member D.");
  }
  result.checks.memberIdentityMatched = true;
  result.checks.walletLoaded = true;
}

async function verifyConsumerNavigationAndBenefit(page) {
  const logoutLink = page.locator('.join-link[data-auth-state="signed-in"]');
  await logoutLink.waitFor({ state: "visible", timeout: 30_000 });
  if ((await logoutLink.textContent())?.trim() !== "로그아웃") {
    throw new Error("Authenticated navigation did not replace the signup link with logout.");
  }
  result.checks.consumerNavAuthenticated = true;

  await goto(page, "/benefits.html");
  const firstOffer = page.locator('.benefit-offer a[href*="benefit-detail.html?id="]').first();
  await firstOffer.waitFor({ state: "visible", timeout: 30_000 });
  const href = await firstOffer.getAttribute("href");
  if (!href || !href.includes("benefit-detail.html?id=")) {
    throw new Error("Benefit list did not expose a valid detail link.");
  }
  await goto(page, `/${href}`);
  const detailTitle = page.locator("#detailTitle");
  const applicationForm = page.locator("#demoApplicationForm");
  const breadcrumbTitle = page.locator("#crumbTitle");
  await detailTitle.waitFor({ state: "visible", timeout: 30_000 });
  await applicationForm.waitFor({ state: "visible", timeout: 30_000 });
  await breadcrumbTitle.waitFor({ state: "visible", timeout: 30_000 });
  const titleText = (await detailTitle.textContent())?.trim();
  const breadcrumbText = (await breadcrumbTitle.textContent())?.trim();
  if (!titleText || breadcrumbText !== titleText) {
    throw new Error("Benefit detail page did not render a consistent title and application form.");
  }
  result.checks.benefitDetailLoaded = true;
}

async function openProfile(page) {
  await goto(page, "/profile.html");
  await page.locator("#basicForm").waitFor({ state: "visible", timeout: 30_000 });
  result.checks.myPageLoaded = true;
}

async function createTemporaryAddress(page) {
  const label = `CI 배송지 ${String(config.runId).slice(-12)}`.slice(0, 30);
  const recipient = config.memberName;
  const phone = await page.locator("#basicPhone").inputValue();
  const postalCode = "04524";
  const address = "서울특별시 중구 세종대로 110";
  const addressDetail = `자동검사 ${String(config.runId).slice(-12)}`.slice(0, 150);

  await page.locator("#addAddress").click();
  const form = page.locator("#addressForm");
  await form.waitFor({ state: "visible", timeout: 30_000 });
  await form.locator('[name="label"]').fill(label);
  await form.locator('[name="recipient"]').fill(recipient);
  await form.locator('[name="phone"]').fill(phone);
  await form.locator('[name="postalCode"]').fill(postalCode);
  await form.locator('[name="address"]').fill(address);
  await form.locator('[name="addressDetail"]').fill(addressDetail);
  await form.locator('[name="isDefault"]').uncheck();
  await form.locator('button[type="submit"]').click();

  const card = page.locator("#addressList .address-card", { hasText: label }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  const cardText = (await card.textContent()) || "";
  if (!cardText.includes(recipient) || !cardText.includes(address)) {
    throw new Error("Temporary delivery address was not rendered with the expected values.");
  }
  temporaryAddressNeedsRemoval = true;
  result.checks.deliveryAddressSaved = true;
  return { label, recipient, phone, postalCode, address, addressDetail };
}

async function verifyGroupBuyAddressPrefill(page, temporaryAddress) {
  await goto(page, "/groupbuy.html");
  const productLink = page.locator('.product-card[href*="groupbuy-detail.html?id="]').first();
  await productLink.waitFor({ state: "visible", timeout: 30_000 });
  const href = await productLink.getAttribute("href");
  if (!href) throw new Error("No published group-buy detail link was available for address verification.");
  testProductId = new URL(href, config.baseUrl).searchParams.get("id") || "";
  if (!testProductId) throw new Error("Published group-buy link did not contain a product identifier.");

  await goto(page, `/${href}`);
  const addressField = page.locator("#savedAddressField");
  await addressField.waitFor({ state: "visible", timeout: 30_000 });
  const option = page.locator("#savedAddress option", { hasText: temporaryAddress.label }).first();
  await option.waitFor({ state: "attached", timeout: 30_000 });
  const optionValue = await option.getAttribute("value");
  if (!optionValue) throw new Error("Temporary delivery address was missing from the group-buy selector.");
  await page.locator("#savedAddress").selectOption(optionValue);

  const form = page.locator("#orderForm");
  const values = {
    recipient: await form.locator('[name="recipient"]').inputValue(),
    phone: await form.locator('[name="deliveryPhone"]').inputValue(),
    postalCode: await form.locator('[name="postalCode"]').inputValue(),
    address: await form.locator('[name="address"]').inputValue(),
    addressDetail: await form.locator('[name="addressDetail"]').inputValue(),
  };
  if (
    values.recipient !== temporaryAddress.recipient ||
    values.phone !== temporaryAddress.phone ||
    values.postalCode !== temporaryAddress.postalCode ||
    values.address !== temporaryAddress.address ||
    values.addressDetail !== temporaryAddress.addressDetail
  ) {
    throw new Error("Saved delivery address did not prefill the group-buy form exactly.");
  }
  result.checks.groupBuyAddressPrefilled = true;
}

async function submitGroupBuyOrder(page) {
  const form = page.locator("#orderForm");
  const marker = `CI 자동검사 ${config.runId}`.slice(0, 200);
  await form.locator('[name="message"]').fill(marker);
  await form.locator('[name="saveAddress"]').uncheck();
  await form.locator('[name="agree"]').check();
  await page.locator("#orderButton").click();
  const resultBox = page.locator("#orderResult");
  await resultBox.waitFor({ state: "visible", timeout: 30_000 });
  const resultText = (await resultBox.textContent()) || "";
  const receipt = resultText.match(/NCC-G-[0-9-]+/)?.[0] || "";
  if (!receipt || !resultText.includes("참여 신청이 접수되었습니다")) {
    throw new Error("Group-buy test order was not submitted with a valid receipt.");
  }
  testOrderReceipt = receipt;
  testOrderNeedsCleanup = true;
  result.testOrderReceipt = receipt;
  result.checks.groupBuyOrderSubmitted = true;
}

async function loginGroupBuyAdmin(page) {
  await goto(page, "/admin-groupbuy.html");
  await page.waitForTimeout(1_500);
  if (!(await page.locator("#adminArea").isVisible())) {
    await page.locator("#loginArea").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#adminEmail").fill(config.adminEmail);
    await page.locator("#adminPassword").fill(config.adminPassword);
    await page.locator("#loginButton").click();
  }
  await page.locator("#adminArea").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-tab="orders"]').click();
  await page.locator("#ordersPanel").waitFor({ state: "visible", timeout: 30_000 });
}

async function locateGroupBuyOrder(page) {
  await page.locator("#orderStatusFilter").selectOption("all");
  await page.locator("#orderSearch").fill(testOrderReceipt);
  const card = page.locator("#orderList .application-card", { hasText: testOrderReceipt }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await card.textContent()) || "";
  if (!text.includes("CI 자동검사")) {
    throw new Error("Safety stop: located order is not marked as an automation order.");
  }
  return card;
}

async function saveGroupBuyOrderState(page, status, values = {}) {
  let card = await locateGroupBuyOrder(page);
  await card.locator('select[id^="order-"]').selectOption(status);
  if (values.paymentGuide !== undefined) {
    await card.locator('textarea[id^="payment-"]').fill(values.paymentGuide);
  }
  if (values.carrier !== undefined) {
    await card.locator('input[id^="carrier-"]').fill(values.carrier);
  }
  if (values.trackingNumber !== undefined) {
    await card.locator('input[id^="tracking-"]').fill(values.trackingNumber);
  }
  if (values.adminMemo !== undefined) {
    await card.locator('textarea[id^="memo-"]').fill(values.adminMemo);
  }
  const saveButton = card.locator("button[data-order-save]");
  await saveButton.click();
  await page.waitForFunction(
    receipt => {
      const cards = Array.from(document.querySelectorAll("#orderList .application-card"));
      const target = cards.find(node => (node.textContent || "").includes(receipt));
      const button = target?.querySelector("button[data-order-save]");
      return Boolean(button && !button.disabled);
    },
    testOrderReceipt,
    { timeout: 30_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#adminArea").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-tab="orders"]').click();
  await page.locator("#ordersPanel").waitFor({ state: "visible", timeout: 30_000 });
  card = await locateGroupBuyOrder(page);
  await card.locator('select[id^="order-"]').waitFor({ state: "visible", timeout: 30_000 });
  if ((await card.locator('select[id^="order-"]').inputValue()) !== status) {
    throw new Error(`Group-buy order status did not persist as ${status}.`);
  }
}

async function paymentApiRequest(page, path, authorization, body) {
  const response = await page.evaluate(async ({ path, authorization, body }) => {
    const request = {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization, accept: "application/json" },
    };
    if (body !== undefined) {
      request.headers["content-type"] = "application/json";
      request.body = JSON.stringify(body);
    }
    const result = await fetch(`/api/payments/${path}`, request);
    return { status: result.status, body: await result.json().catch(() => ({})) };
  }, { path, authorization, body });
  return response;
}

function paymentKey(operation) {
  const safeRunId = String(config.runId).replace(/[^A-Za-z0-9_-]/g, "").slice(-55);
  return `ncc_e2e_${safeRunId}_${operation}`.slice(0, 100);
}

async function loginPaymentAdmin(page) {
  const adminRequest = page.waitForRequest(
    request => request.url().includes("/api/payments/admin/list") && Boolean(request.headers().authorization),
    { timeout: 30_000 },
  );
  await goto(page, "/admin-payments");
  await page.waitForTimeout(1_000);
  if (!(await page.locator("#adminArea").isVisible())) {
    await page.locator("#loginArea").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#adminEmail").fill(config.adminEmail);
    await page.locator("#adminPassword").fill(config.adminPassword);
    await page.locator("#loginButton").click();
  }
  await page.locator("#adminArea").waitFor({ state: "visible", timeout: 30_000 });
  const request = await adminRequest;
  const authorization = request.headers().authorization || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Administrator payment authorization was not captured.");
  secrets.push(authorization, authorization.slice(7));
  return authorization;
}

async function verifyTestPaymentLifecycle(memberPage, adminContext) {
  const memberRequest = memberPage.waitForRequest(
    request => request.url().includes("/api/payments/me") && Boolean(request.headers().authorization),
    { timeout: 30_000 },
  );
  await openProfile(memberPage);
  const orderCard = memberPage.locator('.groupbuy-order-card', { hasText: testOrderReceipt }).first();
  await orderCard.waitFor({ state: "visible", timeout: 30_000 });
  const orderId = await orderCard.locator("[data-test-payment]").getAttribute("data-test-payment");
  if (!orderId) throw new Error("Confirmed automation order did not expose the test-payment action.");
  const request = await memberRequest;
  memberAuthorization = request.headers().authorization || "";
  if (!memberAuthorization.startsWith("Bearer ")) throw new Error("Member payment authorization was not captured.");
  secrets.push(memberAuthorization, memberAuthorization.slice(7));

  const configResponse = await paymentApiRequest(memberPage, "config", "", undefined);
  if (
    configResponse.status !== 200
    || configResponse.body.enabled !== true
    || configResponse.body.mode !== "test"
    || configResponse.body.realCharge !== false
    || configResponse.body.auditVersion !== "2026-08-26-admin-route-auth"
  ) {
    throw new Error("Payment configuration is not locked to the safe test mode.");
  }
  result.checks.testPaymentConfigSafe = true;

  const prepared = await paymentApiRequest(memberPage, "prepare", memberAuthorization, { orderId });
  if (prepared.status !== 201 || prepared.body.payment?.status !== "ready" || prepared.body.payment?.testMode !== true) {
    throw new Error("Test payment preparation did not create a safe ready payment.");
  }
  testPaymentId = prepared.body.payment.id;
  testPaymentAmount = Number(prepared.body.payment.amount);
  paymentNeedsRefund = true;
  result.checks.testPaymentPrepared = true;

  const preparedAgain = await paymentApiRequest(memberPage, "prepare", memberAuthorization, { orderId });
  if (preparedAgain.status !== 200 || preparedAgain.body.reused !== true || preparedAgain.body.payment?.id !== testPaymentId) {
    throw new Error("Repeated payment preparation was not safely reused.");
  }
  result.checks.testPaymentPrepareReused = true;

  const adminPaymentPage = await adminContext.newPage();
  adminAuthorization = await loginPaymentAdmin(adminPaymentPage);

  const confirmKey = paymentKey("confirm");
  const confirmed = await paymentApiRequest(memberPage, "confirm", memberAuthorization, {
    paymentId: testPaymentId,
    idempotencyKey: confirmKey,
  });
  if (confirmed.status !== 200 || confirmed.body.payment?.status !== "paid" || confirmed.body.payment?.paidAmount !== testPaymentAmount) {
    throw new Error("Test payment confirmation did not reach the paid state.");
  }
  result.checks.testPaymentConfirmed = true;

  const duplicate = await paymentApiRequest(memberPage, "confirm", memberAuthorization, {
    paymentId: testPaymentId,
    idempotencyKey: confirmKey,
  });
  const conflictingDuplicate = await paymentApiRequest(memberPage, "confirm", memberAuthorization, {
    paymentId: testPaymentId,
    idempotencyKey: paymentKey("conflicting-confirm"),
  });
  if (duplicate.status !== 200 || duplicate.body.reused !== true || conflictingDuplicate.status !== 409) {
    throw new Error("Duplicate test-payment confirmation was not prevented or idempotently reused.");
  }
  result.checks.testPaymentDuplicatePrevented = true;

  const partialAmount = Math.max(1, Math.floor(testPaymentAmount / 2));
  const partialKey = paymentKey("partial-refund");
  const partial = await paymentApiRequest(adminPaymentPage, "admin/refund", adminAuthorization, {
    paymentId: testPaymentId,
    amount: partialAmount,
    idempotencyKey: partialKey,
  });
  const partialAgain = await paymentApiRequest(adminPaymentPage, "admin/refund", adminAuthorization, {
    paymentId: testPaymentId,
    amount: partialAmount,
    idempotencyKey: partialKey,
  });
  const partialList = await paymentApiRequest(adminPaymentPage, "admin/list", adminAuthorization, undefined);
  const partialCurrent = partialList.body.payments?.find(item => item.id === testPaymentId);
  if (
    partial.status !== 200
    || partialAgain.status !== 200
    || partialAgain.body.reused !== true
    || partialList.status !== 200
    || partialCurrent?.status !== "partially_refunded"
    || partialCurrent?.refundedAmount !== partialAmount
  ) {
    throw new Error(`Partial test refund validation failed (first=${partial.status}/${partial.body.code || partial.body.payment?.status || "unknown"}, replay=${partialAgain.status}/${partialAgain.body.code || String(partialAgain.body.reused)}, current=${partialList.status}/${partialCurrent?.status || "missing"}/${partialCurrent?.refundedAmount ?? "missing"}).`);
  }
  result.checks.testPaymentPartiallyRefunded = true;

  const remaining = testPaymentAmount - partialAmount;
  const full = await paymentApiRequest(adminPaymentPage, "admin/refund", adminAuthorization, {
    paymentId: testPaymentId,
    amount: remaining,
    idempotencyKey: paymentKey("full-refund"),
  });
  if (full.status !== 200 || full.body.payment?.status !== "refunded" || full.body.payment?.refundedAmount !== testPaymentAmount) {
    throw new Error("Full test refund did not return the complete amount.");
  }
  paymentNeedsRefund = false;
  result.checks.testPaymentFullyRefunded = true;

  const memberHistory = await paymentApiRequest(memberPage, "me", memberAuthorization, undefined);
  const payment = memberHistory.body.payments?.find(item => item.id === testPaymentId);
  if (memberHistory.status !== 200 || payment?.status !== "refunded" || payment?.refundedAmount !== testPaymentAmount) {
    throw new Error("Member payment history did not show the full test refund.");
  }
  result.checks.testPaymentMemberHistoryVerified = true;
  await adminPaymentPage.close();
}

async function verifyGroupBuyLifecycle(page, memberPage) {
  await loginGroupBuyAdmin(page);
  const paymentGuide = `CI 결제 안내 ${config.runId}`.slice(0, 200);
  const carrier = "CI택배";
  const trackingNumber = `CI-${String(config.runId).replace(/[^0-9A-Za-z-]/g, "").slice(-30)}`;
  const adminMemo = `CI 자동검사 주문 ${config.runId}`.slice(0, 200);

  await saveGroupBuyOrderState(page, "confirmed", { paymentGuide, adminMemo });
  result.checks.groupBuyOrderConfirmed = true;
  await verifyTestPaymentLifecycle(memberPage, page.context());
  await saveGroupBuyOrderState(page, "paid");
  result.checks.groupBuyPaymentConfirmed = true;
  await saveGroupBuyOrderState(page, "shipping", { carrier, trackingNumber });
  result.checks.groupBuyOrderShipping = true;
  await saveGroupBuyOrderState(page, "completed");
  result.checks.groupBuyOrderCompleted = true;
  return { paymentGuide, carrier, trackingNumber };
}

async function verifyMemberOrderTracking(page, expected) {
  await openProfile(page);
  const card = page.locator('.groupbuy-order-card', { hasText: testOrderReceipt }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  const text = (await card.textContent()) || "";
  for (const value of ["완료", expected.paymentGuide, expected.carrier, expected.trackingNumber]) {
    if (!text.includes(value)) {
      throw new Error("Member order tracking did not show the completed payment and delivery data.");
    }
  }
  result.checks.memberOrderTrackingVerified = true;
}

async function loginFeedbackAdmin(page) {
  await goto(page, "/admin-feedback.html");
  await page.waitForTimeout(1_000);
  if (!(await page.locator("#adminArea").isVisible())) {
    await page.locator("#loginArea").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator('#loginForm input[name="email"]').fill(config.adminEmail);
    await page.locator('#loginForm input[name="password"]').fill(config.adminPassword);
    await page.locator('#loginForm button[type="submit"]').click();
  }
  await page.locator("#adminArea").waitFor({ state: "visible", timeout: 30_000 });
}

async function deleteFeedbackCard(page, tab, marker) {
  await page.locator(`[data-tab="${tab}"]`).click();
  const card = page.locator("#feedbackList .platform-card", { hasText: marker }).first();
  if ((await card.count()) === 0) return false;
  let accepted = false;
  page.once("dialog", async dialog => {
    accepted = true;
    await dialog.accept();
  });
  await card.locator("[data-delete]").click();
  await card.waitFor({ state: "detached", timeout: 30_000 });
  if (!accepted) throw new Error("Feedback cleanup confirmation was not accepted.");
  return true;
}

async function cleanupFeedback(page) {
  await loginFeedbackAdmin(page);
  await deleteFeedbackCard(page, "reports", feedbackReportReason);
  await deleteFeedbackCard(page, "reviews", feedbackReviewTitle);
  await deleteFeedbackCard(page, "comments", feedbackExpectation);
  feedbackNeedsCleanup = false;
  result.checks.feedbackDataRemoved = true;
}

async function cleanupFailedFeedbackRuns(page) {
  await loginFeedbackAdmin(page);
  for (const runId of ["32957281264-1", "32957948677-1"]) {
    await deleteFeedbackCard(page, "reports", `CI 신고 ${runId}`);
    await deleteFeedbackCard(page, "reviews", `CI 후기 ${runId}`);
    await deleteFeedbackCard(page, "comments", `CI 기대평 ${runId}`);
  }
}

async function verifyFeedbackLifecycle(memberPage, adminContext) {
  const recoveryPage = await adminContext.newPage();
  await cleanupFailedFeedbackRuns(recoveryPage);
  await recoveryPage.close();

  await goto(memberPage, `/groupbuy-detail.html?id=${encodeURIComponent(testProductId)}`);
  await memberPage.locator("#expectationForm").waitFor({ state: "visible", timeout: 30_000 });
  const reviewForm = memberPage.locator("#reviewForm");
  await memberPage.waitForFunction(
    () => (document.querySelector("#reviewMessage")?.textContent || "").includes("이용 완료 기록이 확인되었습니다"),
    undefined,
    { timeout: 30_000 },
  );
  await reviewForm.waitFor({ state: "visible", timeout: 30_000 });
  const feedbackErrors = [];
  memberPage.on("console", message => {
    if (message.type() === "error") feedbackErrors.push(redact(message.text()));
  });
  await memberPage.locator("#expectationInput").fill(feedbackExpectation);
  feedbackNeedsCleanup = true;
  await memberPage.locator('#expectationForm button[type="submit"]').click();
  const comment = memberPage.locator("#expectationList .feedback-item", { hasText: feedbackExpectation }).first();
  try {
    await comment.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    const message = ((await memberPage.locator("#expectationMessage").textContent()) || "표시 메시지 없음").trim();
    throw new Error(`Expectation was not rendered: ${message}; console: ${feedbackErrors.slice(-3).join(" | ") || "none"}`);
  }
  result.checks.expectationCreated = true;

  await comment.locator("[data-like]").click();
  const likedComment = memberPage.locator("#expectationList .feedback-item", { hasText: feedbackExpectation }).first();
  await likedComment.locator("[data-like]").filter({ hasText: "좋아요 1" }).waitFor({ state: "visible", timeout: 30_000 });
  result.checks.expectationLiked = true;
  await likedComment.locator("[data-like]").click();
  await memberPage.waitForFunction(() => (document.querySelector("#expectationMessage")?.textContent || "").includes("한 번만"), undefined, { timeout: 30_000 });
  result.checks.duplicateLikePrevented = true;

  memberPage.once("dialog", async prompt => {
    await prompt.accept(feedbackReportReason);
    memberPage.once("dialog", async alert => alert.accept());
  });
  await memberPage.locator("#expectationList .feedback-item", { hasText: feedbackExpectation }).first().locator("[data-report]").click();
  await memberPage.waitForTimeout(1_000);
  result.checks.feedbackReported = true;

  await memberPage.locator("#reviewRating").selectOption("5");
  await memberPage.locator("#reviewTitle").fill(feedbackReviewTitle);
  await memberPage.locator("#reviewContent").fill(feedbackReviewContent);
  await reviewForm.locator('button[type="submit"]').click();
  const review = memberPage.locator("#reviewList .review-item", { hasText: feedbackReviewTitle }).first();
  try {
    await review.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    const message = ((await memberPage.locator("#reviewMessage").textContent()) || "표시 메시지 없음").trim();
    throw new Error(`Verified review was not rendered: ${message}; console: ${feedbackErrors.slice(-3).join(" | ") || "none"}`);
  }
  result.checks.verifiedReviewCreated = true;

  const adminPage = await adminContext.newPage();
  await loginFeedbackAdmin(adminPage);
  await adminPage.locator('[data-tab="reports"]').click();
  let reportCard = adminPage.locator("#feedbackList .platform-card", { hasText: feedbackReportReason }).first();
  await reportCard.waitFor({ state: "visible", timeout: 30_000 });
  await reportCard.locator('[data-status$=":resolved"]').click();
  reportCard = adminPage.locator("#feedbackList .platform-card", { hasText: feedbackReportReason }).first();
  await reportCard.filter({ hasText: "resolved" }).waitFor({ state: "visible", timeout: 30_000 });
  result.checks.feedbackAdminStatusSaved = true;
  await cleanupFeedback(adminPage);
  await adminPage.close();
}

async function cleanupGroupBuyOrder(page) {
  await saveGroupBuyOrderState(page, "cancelled", {
    adminMemo: `CI 자동검사 완료 후 정리 ${config.runId}`.slice(0, 200),
  });
  result.checks.groupBuyOrderCancelled = true;
  let card = await locateGroupBuyOrder(page);
  const cleanupButton = card.locator("button[data-order-cleanup]");
  await cleanupButton.waitFor({ state: "visible", timeout: 30_000 });
  let confirmationAccepted = false;
  page.once("dialog", async (dialog) => {
    if (!dialog.message().includes("자동검사 주문")) {
      await dialog.dismiss();
      return;
    }
    confirmationAccepted = true;
    await dialog.accept();
  });
  await cleanupButton.click();
  await page.locator("#orderSearch").fill(testOrderReceipt);
  await page.waitForFunction(
    receipt => !Array.from(document.querySelectorAll("#orderList .application-card")).some(card =>
      (card.textContent || "").includes(receipt)),
    testOrderReceipt,
    { timeout: 30_000 },
  );
  if (!confirmationAccepted) {
    throw new Error("Automation order cleanup confirmation was not accepted.");
  }
  testOrderNeedsCleanup = false;
  result.checks.groupBuyOrderRemoved = true;
}

async function removeTemporaryAddress(page, label) {
  await openProfile(page);
  const card = page.locator("#addressList .address-card", { hasText: label }).first();
  if ((await card.count()) === 0) {
    temporaryAddressNeedsRemoval = false;
    result.checks.deliveryAddressRemoved = true;
    return;
  }
  let confirmationAccepted = false;
  page.once("dialog", async dialog => {
    if (!dialog.message().includes("삭제")) {
      await dialog.dismiss();
      return;
    }
    confirmationAccepted = true;
    await dialog.accept();
  });
  await card.locator("[data-delete]").click();
  await card.waitFor({ state: "detached", timeout: 30_000 });
  if (!confirmationAccepted) throw new Error("Temporary delivery address deletion was not confirmed.");
  temporaryAddressNeedsRemoval = false;
  result.checks.deliveryAddressRemoved = true;
}

async function saveRegion(page, region) {
  await page.locator("#basicRegion").fill(region);
  await page.locator('#basicForm button[type="submit"]').click();
  await page.waitForFunction(
    () => {
      const node = document.querySelector("#basicMessage");
      return node && (node.textContent || "").trim() === "기본정보가 저장되었습니다.";
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#basicForm").waitFor({ state: "visible", timeout: 30_000 });
  const saved = await page.locator("#basicRegion").inputValue();
  if (saved !== region) {
    throw new Error("Member profile value did not persist as expected.");
  }
}

async function submitWithdrawalRequest(page) {
  await page.locator("#withdrawReason").fill(
    `GitHub Actions 자동검사 ${config.runId} — 실제 계정 파기 금지`,
  );
  await page.locator("#withdrawConfirm").check();

  let confirmationAccepted = false;
  page.once("dialog", async (dialog) => {
    const message = dialog.message();
    if (!message.includes("탈퇴")) {
      await dialog.dismiss();
      return;
    }
    confirmationAccepted = true;
    await dialog.accept();
  });

  await page.locator('#withdrawForm button[type="submit"]').click();
  await page.waitForFunction(
    () => {
      const node = document.querySelector("#withdrawMessage");
      return node && (node.textContent || "").trim() === "회원탈퇴 요청이 접수되었습니다. 본사 확인 후 처리됩니다.";
    },
    undefined,
    { timeout: 30_000 },
  );
  if (!confirmationAccepted) {
    throw new Error("Withdrawal request confirmation was not accepted.");
  }
  result.checks.withdrawalRequested = true;
}

async function loginAdmin(page) {
  await goto(page, "/admin-accounts.html");
  await page.locator("#adminAccountLogin").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#adminEmail").fill(config.adminEmail);
  await page.locator("#adminPassword").fill(config.adminPassword);
  await page.locator("#adminLoginButton").click();
  await page.locator("#adminAccountArea").waitFor({ state: "visible", timeout: 30_000 });
}

async function locateMemberRequest(page) {
  await page.locator("#requestSearch").fill(config.memberNumber);
  const card = page.locator("#requestList .request-card", { hasText: config.memberNumber }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  return card;
}

async function rejectWithdrawalRequest(page) {
  await loginAdmin(page);
  let card = await locateMemberRequest(page);

  if ((await card.locator("[data-finalize-action]").count()) !== 0) {
    throw new Error("Safety stop: final account disposal controls unexpectedly appeared.");
  }

  const statusSelect = card.locator('select[id^="request-status-"]');
  await statusSelect.selectOption("rejected");
  if ((await statusSelect.inputValue()) !== "rejected") {
    throw new Error("Safety stop: withdrawal request was not set to rejected.");
  }

  await card
    .locator('textarea[id^="request-memo-"]')
    .fill(`CI 자동검사 반려 ${config.runId} — 계정 active 유지, 실제 파기 금지`);

  let confirmationAccepted = false;
  page.once("dialog", async (dialog) => {
    const message = dialog.message();
    if (!message.includes("반려")) {
      await dialog.dismiss();
      return;
    }
    confirmationAccepted = true;
    await dialog.accept();
  });

  await card.locator("button[data-request-action]").click();
  await page.waitForFunction(
    () => {
      const node = document.querySelector("#requestMessage");
      return node && /반려/.test(node.textContent || "");
    },
    undefined,
    { timeout: 30_000 },
  );
  if (!confirmationAccepted) {
    throw new Error("Withdrawal rejection confirmation was not accepted.");
  }

  card = await locateMemberRequest(page);
  const cardText = (await card.textContent()) || "";
  if (!cardText.includes("반려") || !/계정\s*(활성|active)/i.test(cardText)) {
    throw new Error("Withdrawal rejection or active member status could not be verified.");
  }
  if ((await card.locator("[data-finalize-action]").count()) !== 0) {
    throw new Error("Safety stop: account disposal controls appeared after rejection.");
  }
  result.checks.withdrawalRejected = true;
  requestNeedsRejection = false;

  await page.locator('[data-account-tab="logs"]').click();
  await page.locator("#logSearch").fill(config.memberNumber);
  const log = page
    .locator("#logList .audit-item")
    .filter({ hasText: config.memberNumber })
    .filter({ hasText: "탈퇴 반려" })
    .first();
  await log.waitFor({ state: "visible", timeout: 30_000 });
  const logText = (await log.textContent()) || "";
  if (!/탈퇴.*반려|반려.*탈퇴/.test(logText)) {
    throw new Error("The withdrawal rejection audit log was not found.");
  }
  result.checks.rejectionLogVerified = true;
}

async function writeResult() {
  result.completedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/ncc-e2e-result.json",
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

let browser;
let memberContext;
let adminContext;
let memberPage;
let originalRegion = null;
let temporaryAddress = null;
let temporaryAddressNeedsRemoval = false;
let testOrderReceipt = "";
let testOrderNeedsCleanup = false;
let profileNeedsRestore = false;
let requestNeedsRejection = false;
let memberAuthorization = "";
let adminAuthorization = "";
let testPaymentId = "";
let testPaymentAmount = 0;
let paymentNeedsRefund = false;
let testProductId = "";
let feedbackNeedsCleanup = false;
const feedbackExpectation = `CI 기대평 ${config.runId}`.slice(0, 180);
const feedbackReportReason = `CI 신고 ${config.runId}`.slice(0, 300);
const feedbackReviewTitle = `CI 후기 ${config.runId}`.slice(0, 80);
const feedbackReviewContent = `자동검사로 생성하고 즉시 정리하는 공동구매 이용 인증 후기입니다. ${config.runId}`.slice(0, 1500);
let fatalError = null;

try {
  requireConfig();
  stage("Starting approved test member D checks.");
  browser = await chromium.launch({ headless: true });

  memberContext = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1440, height: 1000 },
  });
  memberPage = await memberContext.newPage();
  await loginMember(memberPage);
  stage("Wallet login and member identity verified.");

  await verifyConsumerNavigationAndBenefit(memberPage);
  stage("Authenticated navigation and benefit detail routing verified.");

  await openProfile(memberPage);
  temporaryAddress = await createTemporaryAddress(memberPage);
  stage("Temporary delivery address saved.");

  await verifyGroupBuyAddressPrefill(memberPage, temporaryAddress);
  stage("Saved delivery address prefilled the group-buy form.");

  await submitGroupBuyOrder(memberPage);
  stage("Automation-marked group-buy order submitted.");

  adminContext = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1440, height: 1000 },
  });
  const groupBuyAdminPage = await adminContext.newPage();
  const orderTracking = await verifyGroupBuyLifecycle(groupBuyAdminPage, memberPage);
  stage("Test payment prepare, confirmation, duplicate prevention, partial refund, and full refund verified.");
  stage("Order confirmation, payment, shipping, and completion states verified.");

  await verifyFeedbackLifecycle(memberPage, adminContext);
  stage("Expectation, like, duplicate prevention, report, verified review, administrator handling, and cleanup verified.");

  await verifyMemberOrderTracking(memberPage, orderTracking);
  stage("Member-visible order payment and delivery tracking verified.");

  await cleanupGroupBuyOrder(groupBuyAdminPage);
  stage("Automation order cancelled and removed after lifecycle verification.");
  await adminContext.close();
  adminContext = null;

  await removeTemporaryAddress(memberPage, temporaryAddress.label);
  stage("Temporary delivery address removed.");

  originalRegion = await memberPage.locator("#basicRegion").inputValue();
  if (!originalRegion.trim()) {
    throw new Error("Safety stop: the original region is empty, so reversible profile testing was skipped.");
  }

  const temporaryRegion = `${originalRegion} [CI ${config.runId}]`.slice(0, 190);
  await saveRegion(memberPage, temporaryRegion);
  profileNeedsRestore = true;
  result.checks.memberInfoTemporarilyChanged = true;
  stage("Temporary member information change verified.");

  await saveRegion(memberPage, originalRegion);
  profileNeedsRestore = false;
  result.checks.memberInfoRestored = true;
  stage("Member information restored to its original value.");

  await submitWithdrawalRequest(memberPage);
  requestNeedsRejection = true;
  stage("Withdrawal request submitted without changing member status.");

  adminContext = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1440, height: 1000 },
  });
  const adminPage = await adminContext.newPage();
  await rejectWithdrawalRequest(adminPage);
  requestNeedsRejection = false;
  stage("Withdrawal request rejected and audit log verified.");

  const finalContext = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1440, height: 1000 },
  });
  const finalPage = await finalContext.newPage();
  await loginMember(finalPage);
  result.checks.finalLoginSucceeded = true;
  await openProfile(finalPage);
  result.checks.finalStatusActive = true;
  await finalContext.close();
  stage("Final active login, wallet, and My Page access verified.");

  result.status = "passed";
} catch (error) {
  fatalError = error;
  result.status = "failed";
  result.failure = redact(error?.message || error);
} finally {
  if (feedbackNeedsCleanup && browser) {
    try {
      adminContext ||= await browser.newContext({ locale: "ko-KR" });
      const cleanupFeedbackPage = await adminContext.newPage();
      await cleanupFeedback(cleanupFeedbackPage);
      stage("Emergency feedback cleanup completed.");
    } catch (error) {
      console.error(`::error::Emergency feedback cleanup failed: ${redact(error?.message || error)}`);
      fatalError ||= new Error(`Emergency feedback cleanup failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  if (paymentNeedsRefund && testPaymentId && adminAuthorization && memberPage) {
    stage("Starting emergency test-payment cancellation/refund.");
    try {
      const memberHistory = await paymentApiRequest(memberPage, "me", memberAuthorization, undefined);
      const payment = memberHistory.body.payments?.find(item => item.id === testPaymentId);
      if (!payment) throw new Error("Emergency cleanup could not find the test payment.");
      if (payment.status === "ready") {
        const cancelled = await paymentApiRequest(memberPage, "admin/cancel", adminAuthorization, {
          paymentId: testPaymentId,
          idempotencyKey: paymentKey("emergency-cancel"),
        });
        if (cancelled.status !== 200 || cancelled.body.payment?.status !== "cancelled") {
          throw new Error("Emergency ready-payment cancellation did not complete.");
        }
      } else if (["paid", "partially_refunded"].includes(payment.status)) {
        const remaining = Number(payment.paidAmount || testPaymentAmount) - Number(payment.refundedAmount || 0);
        const emergency = await paymentApiRequest(memberPage, "admin/refund", adminAuthorization, {
          paymentId: testPaymentId,
          amount: remaining,
          idempotencyKey: paymentKey("emergency-refund"),
        });
        if (emergency.status !== 200 || emergency.body.payment?.status !== "refunded") {
          throw new Error("Emergency full test refund did not complete.");
        }
        result.checks.testPaymentFullyRefunded = true;
      } else if (!["refunded", "cancelled"].includes(payment.status)) {
        throw new Error(`Emergency cleanup rejected unexpected payment state: ${payment.status}`);
      }
      paymentNeedsRefund = false;
      stage("Emergency test-payment cancellation/refund completed.");
    } catch (error) {
      console.error(`::error::Emergency test-payment cleanup failed: ${redact(error?.message || error)}`);
      fatalError ||= new Error(`Emergency test-payment refund failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  if (testOrderNeedsCleanup && testOrderReceipt && browser) {
    try {
      adminContext ||= await browser.newContext({ locale: "ko-KR" });
      const cleanupOrderPage = await adminContext.newPage();
      await loginGroupBuyAdmin(cleanupOrderPage);
      await cleanupGroupBuyOrder(cleanupOrderPage);
      stage("Emergency automation-order cleanup completed.");
    } catch (error) {
      fatalError ||= new Error(`Emergency automation-order cleanup failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  if (temporaryAddressNeedsRemoval && temporaryAddress && memberPage) {
    try {
      await removeTemporaryAddress(memberPage, temporaryAddress.label);
      stage("Emergency temporary delivery-address cleanup completed.");
    } catch (error) {
      fatalError ||= new Error(`Emergency delivery-address cleanup failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  if (profileNeedsRestore && memberPage && originalRegion !== null) {
    try {
      await openProfile(memberPage);
      await saveRegion(memberPage, originalRegion);
      profileNeedsRestore = false;
      result.checks.memberInfoRestored = true;
      stage("Emergency profile rollback completed.");
    } catch (error) {
      fatalError ||= new Error(`Emergency profile rollback failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  if (requestNeedsRejection && browser) {
    try {
      adminContext ||= await browser.newContext({ locale: "ko-KR" });
      const cleanupPage = await adminContext.newPage();
      await rejectWithdrawalRequest(cleanupPage);
      requestNeedsRejection = false;
      stage("Emergency withdrawal-request rejection completed.");
    } catch (error) {
      fatalError ||= new Error(`Emergency withdrawal rejection failed: ${redact(error?.message || error)}`);
      result.status = "failed";
      result.failure = redact(fatalError.message);
    }
  }

  result.safety.accountDeletionAttempted = false;
  result.safety.passwordChanged = false;
  result.safety.emailChanged = false;
  await writeResult();
  await browser?.close();
}

if (fatalError) {
  console.error(`::error::NCC E2E failed: ${redact(fatalError.message || fatalError)}`);
  process.exit(1);
}

stage("All protected checks passed; test member D remains active.");
