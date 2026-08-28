import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const PROJECT_NAME = "ncc365-website";
const PUBLIC_CONFIG_URL = "https://ncc365.com/api/payments/config";
const LIVE_CONFIRMATION = "NCC-TOSS-LIVE-CONFIRMED";
const KEY_PATTERNS = {
  client: /^(test|live)_gck_[0-9A-Za-z_-]{8,}$/,
  secret: /^(test|live)_gsk_[0-9A-Za-z_-]{8,}$/,
};

function requireValue(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Required value is missing: ${name}`);
  return normalized;
}

export function validateTossKeys(target, clientKey, secretKey) {
  if (target === "disabled") return { clientKey: "", secretKey: "" };
  const client = requireValue(clientKey, "TOSS client key");
  const secret = requireValue(secretKey, "TOSS secret key");
  if (client.match(KEY_PATTERNS.client)?.[1] !== target) {
    throw new Error(`The Toss client key is not a ${target} Payment Widget client key`);
  }
  if (secret.match(KEY_PATTERNS.secret)?.[1] !== target) {
    throw new Error(`The Toss secret key is not a ${target} Payment Widget secret key`);
  }
  return { clientKey: client, secretKey: secret };
}

function safeVariables() {
  return {
    PAYMENT_MODE: { type: "plain_text", value: "test" },
    PAYMENT_PROVIDER: { type: "plain_text", value: "simulation" },
    TOSS_MODE: { type: "plain_text", value: "disabled" },
    TOSS_LIVE_CONFIRMATION: { type: "plain_text", value: "disabled" },
  };
}

function normalizeTesterEmails(value) {
  const emails = [...new Set(
    String(value || "")
      .split(",")
      .map(email => email.trim().toLowerCase())
      .filter(Boolean),
  )];
  if (!emails.length || emails.some(email => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new Error("Toss test activation requires one or more valid internal tester emails");
  }
  return emails.slice(0, 20).join(",");
}

function tossVariables(target, keys, testerEmails = "") {
  const variables = {
    PAYMENT_MODE: { type: "plain_text", value: target },
    PAYMENT_PROVIDER: { type: "plain_text", value: "toss" },
    TOSS_MODE: { type: "plain_text", value: target },
    TOSS_LIVE_CONFIRMATION: {
      type: "plain_text",
      value: target === "live" ? LIVE_CONFIRMATION : "disabled",
    },
    TOSS_CLIENT_KEY: { type: "secret_text", value: keys.clientKey },
    TOSS_SECRET_KEY: { type: "secret_text", value: keys.secretKey },
  };
  if (target === "test") {
    variables.PAYMENT_TESTER_EMAILS = { type: "secret_text", value: normalizeTesterEmails(testerEmails) };
  }
  return variables;
}

export function buildTossActivationPatch(target, clientKey, secretKey, confirmation = "", testerEmails = "") {
  if (!new Set(["disabled", "test", "live"]).has(target)) {
    throw new Error("TOSS target must be disabled, test, or live");
  }
  if (target === "live" && confirmation !== LIVE_CONFIRMATION) {
    throw new Error(`Live activation requires the exact confirmation: ${LIVE_CONFIRMATION}`);
  }
  const keys = validateTossKeys(target, clientKey, secretKey);
  const production = target === "disabled" ? safeVariables() : tossVariables(target, keys, testerEmails);
  const preview = target === "test" ? tossVariables("test", keys, testerEmails) : safeVariables();
  return {
    deployment_configs: {
      production: { env_vars: production },
      preview: { env_vars: preview },
    },
  };
}

function apiErrorSummary(payload, status) {
  const codes = Array.isArray(payload?.errors)
    ? payload.errors.map(error => String(error?.code || "unknown")).join(",")
    : "unknown";
  return `Cloudflare API request failed (HTTP ${status}, codes: ${codes})`;
}

async function cloudflareRequest(accountId, token, path, init = {}) {
  const response = await fetch(`${API_BASE}/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error(apiErrorSummary(payload, response.status));
  return payload.result;
}

async function waitForDeployment(accountId, token, deploymentId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const deployment = await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}/deployments/${deploymentId}`);
    const status = deployment?.latest_stage?.status;
    if (status === "success") return;
    if (status === "failure" || status === "canceled") throw new Error(`Cloudflare Pages deployment ended with status: ${status}`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5_000));
  }
  throw new Error("Timed out waiting for Cloudflare Pages deployment");
}

async function retryLatestDeployment(accountId, token) {
  const deployments = await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}/deployments?env=production&page=1&per_page=20`);
  const latest = deployments.find(deployment => deployment?.latest_stage?.status === "success" && !deployment?.is_skipped);
  if (!latest?.id) throw new Error("No successful production deployment is available to retry");
  const retried = await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}/deployments/${latest.id}/retry`, { method: "POST" });
  if (!retried?.id) throw new Error("Cloudflare did not return a retry deployment ID");
  await waitForDeployment(accountId, token, retried.id);
}

async function waitForConfig(target) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(PUBLIC_CONFIG_URL, { headers: { accept: "application/json", "cache-control": "no-cache" } });
      const config = await response.json();
      const expected = target === "disabled"
        ? config.provider === "simulation" && config.checkoutEnabled === false && config.mode === "test" && config.realCharge === false
        : config.provider === "toss"
          && config.checkoutEnabled === (target === "live")
          && config.mode === target
          && config.realCharge === (target === "live");
      if (response.ok && config.ok === true && config.enabled === true && expected) return config;
    } catch { /* Deployment propagation is retried below. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5_000));
  }
  throw new Error(`Timed out waiting for Toss ${target} configuration`);
}

async function writeSummary(target) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## NCC 토스페이먼츠 전환",
    "",
    `- 적용 대상: \`${target}\``,
    `- 실제 금전이동: ${target === "live" ? "활성" : "비활성"}`,
    `- 운영 확인: ${PUBLIC_CONFIG_URL}`,
    "- 웹훅 URL: `https://ncc365.com/api/payments/webhook/toss`",
    "",
    "참조코드: `REF-NCC-TOSS-PAYMENTS-PREBUILD-MASTER-20`",
    "",
  ].join("\n"));
}

async function main() {
  const accountId = requireValue(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const token = requireValue(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const target = String(process.env.TOSS_TARGET || "disabled").trim().toLowerCase();
  const patch = buildTossActivationPatch(
    target,
    process.env.TOSS_CLIENT_KEY,
    process.env.TOSS_SECRET_KEY,
    String(process.env.TOSS_LIVE_CONFIRMATION || ""),
    process.env.PAYMENT_TESTER_EMAILS,
  );
  const project = await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}`);
  if (project?.name !== PROJECT_NAME) throw new Error("The expected Cloudflare Pages project was not found");
  await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  await retryLatestDeployment(accountId, token);
  await waitForConfig(target);
  await writeSummary(target);
  console.log(`NCC Toss Payments ${target} configuration was applied and verified without printing credentials.`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "NCC Toss Payments configuration failed");
    process.exitCode = 1;
  });
}
