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
    myPageLoaded: false,
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
  const name = (await page.locator("#memberName").textContent())?.trim();
  if (number !== config.memberNumber || !name?.includes(config.memberName)) {
    throw new Error("Safety stop: the signed-in account does not match approved test member D.");
  }
  result.checks.memberIdentityMatched = true;
  result.checks.walletLoaded = true;
}

async function openProfile(page) {
  await goto(page, "/profile.html");
  await page.locator("#basicForm").waitFor({ state: "visible", timeout: 30_000 });
  result.checks.myPageLoaded = true;
}

async function saveRegion(page, region) {
  await page.locator("#basicRegion").fill(region);
  await page.locator('#basicForm button[type="submit"]').click();
  await page.waitForFunction(
    () => {
      const node = document.querySelector("#basicMessage");
      return node && /저장|변경/.test(node.textContent || "");
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
      return node && /접수|요청/.test(node.textContent || "");
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

  await page.locator('[data-account-tab="logs"]').click();
  await page.locator("#logSearch").fill(config.memberNumber);
  const log = page.locator("#logList .audit-item", { hasText: config.memberNumber }).first();
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

  await openProfile(memberPage);
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
