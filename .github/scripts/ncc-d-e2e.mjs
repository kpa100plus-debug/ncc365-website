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
  referenceCode: "REF-NCC-CI-E2E-AUTH-SETUP-01",
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
let profileNeedsRestore = false;
let requestNeedsRejection = false;
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
