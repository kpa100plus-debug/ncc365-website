import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE = "https://api.cloudflare.com/client/v4";
const PROJECT_NAME = "ncc365-website";
const PUBLIC_CONFIG_URL = "https://ncc365.com/api/payments/config";
const ACCOUNT_CONFIG_URL = "https://ncc365.com/api/account/config";

function requireValue(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Required value is missing: ${name}`);
  return normalized;
}

export function readPublicRuntimeConfig(platformConfigSource, adminPaymentsSource) {
  const firebaseApiKey = platformConfigSource.match(/apiKey\s*:\s*["']([^"']+)["']/)?.[1];
  const adminEmail = adminPaymentsSource.match(/const\s+ADMIN_EMAIL\s*=\s*["']([^"']+)["']/)?.[1];

  if (!firebaseApiKey || !/^AIza[0-9A-Za-z_-]+$/.test(firebaseApiKey)) {
    throw new Error("Firebase web API key was not found in js/platform-config.js");
  }
  if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new Error("Administrator email was not found in js/admin-payments.js");
  }

  return {
    firebaseApiKey,
    firebaseProjectId: "ncc-member",
    adminEmail: adminEmail.toLowerCase(),
  };
}

export function buildDeploymentConfigPatch(databaseId, runtimeConfig) {
  const d1Databases = {
    NCC_PAYMENTS: { id: requireValue(databaseId, "D1 database ID") },
  };
  const envVars = {
    PAYMENT_MODE: { type: "plain_text", value: "test" },
    FIREBASE_API_KEY: { type: "plain_text", value: runtimeConfig.firebaseApiKey },
    FIREBASE_PROJECT_ID: { type: "plain_text", value: runtimeConfig.firebaseProjectId },
    ADMIN_EMAIL: { type: "plain_text", value: runtimeConfig.adminEmail },
  };

  return {
    deployment_configs: {
      production: { d1_databases: d1Databases, env_vars: envVars },
      preview: { d1_databases: d1Databases, env_vars: envVars },
    },
  };
}

export function assertProjectConfigured(project, databaseId) {
  for (const environment of ["production", "preview"]) {
    const config = project?.deployment_configs?.[environment];
    if (config?.d1_databases?.NCC_PAYMENTS?.id !== databaseId) {
      throw new Error(`NCC_PAYMENTS binding verification failed for ${environment}`);
    }
    if (config?.env_vars?.PAYMENT_MODE?.value !== "test") {
      throw new Error(`PAYMENT_MODE verification failed for ${environment}`);
    }
    if (config?.env_vars?.FIREBASE_PROJECT_ID?.value !== "ncc-member") {
      throw new Error(`FIREBASE_PROJECT_ID verification failed for ${environment}`);
    }
    if (!config?.env_vars?.FIREBASE_API_KEY?.value) {
      throw new Error(`FIREBASE_API_KEY verification failed for ${environment}`);
    }
    if (!config?.env_vars?.ADMIN_EMAIL?.value) {
      throw new Error(`ADMIN_EMAIL verification failed for ${environment}`);
    }
  }
}

function apiErrorSummary(payload, status) {
  const codes = Array.isArray(payload?.errors)
    ? payload.errors.map((error) => String(error?.code || "unknown")).join(",")
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
  if (!response.ok || payload?.success !== true) {
    throw new Error(apiErrorSummary(payload, response.status));
  }
  return payload.result;
}

async function waitForDeployment(accountId, token, deploymentId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const deployment = await cloudflareRequest(
      accountId,
      token,
      `/pages/projects/${PROJECT_NAME}/deployments/${deploymentId}`,
    );
    const status = deployment?.latest_stage?.status;
    if (status === "success") return deployment;
    if (status === "failure" || status === "canceled") {
      throw new Error(`Cloudflare Pages deployment ended with status: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Timed out waiting for the Cloudflare Pages deployment");
}

async function waitForPublicConfig() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const [paymentResponse, accountResponse] = await Promise.all([
        fetch(PUBLIC_CONFIG_URL, { headers: { accept: "application/json", "cache-control": "no-cache" } }),
        fetch(ACCOUNT_CONFIG_URL, { headers: { accept: "application/json", "cache-control": "no-cache" } }),
      ]);
      const [config, accountConfig] = await Promise.all([paymentResponse.json(), accountResponse.json()]);
      if (
        paymentResponse.ok
        && config?.ok === true
        && config?.enabled === true
        && config?.mode === "test"
        && config?.realCharge === false
        && accountResponse.ok
        && accountConfig?.ok === true
        && accountConfig?.emailRecovery === true
        && accountConfig?.adminAccountManagement === true
      ) {
        return { payment: config, account: accountConfig };
      }
    } catch {
      // A deployment may briefly make the endpoint unavailable. Retry below.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Timed out waiting for safe payment mode and Firebase administrator account management");
}

async function writeSummary() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(
    summaryPath,
    [
      "## NCC 테스트 결제 인프라",
      "",
      "- D1 데이터베이스: 연결 및 스키마 확인 완료",
      "- Pages Production/Preview: `NCC_PAYMENTS` 연결 완료",
      "- 결제 모드: `test` / 실제 결제: 비활성",
      `- 운영 확인: ${PUBLIC_CONFIG_URL}`,
      `- 관리자 계정 복구 확인: ${ACCOUNT_CONFIG_URL}`,
      "",
      "참조코드: `REF-NCC-PAYMENT-TEST-11`",
      "",
    ].join("\n"),
  );
}

async function main() {
  const accountId = requireValue(process.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
  const token = requireValue(process.env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN");
  const databaseId = requireValue(process.env.NCC_PAYMENTS_DATABASE_ID, "NCC_PAYMENTS_DATABASE_ID");
  const [platformConfigSource, adminPaymentsSource] = await Promise.all([
    readFile("js/platform-config.js", "utf8"),
    readFile("js/admin-payments.js", "utf8"),
  ]);
  const runtimeConfig = readPublicRuntimeConfig(platformConfigSource, adminPaymentsSource);
  const patch = buildDeploymentConfigPatch(databaseId, runtimeConfig);

  const existingProject = await cloudflareRequest(
    accountId,
    token,
    `/pages/projects/${PROJECT_NAME}`,
  );
  if (existingProject?.name !== PROJECT_NAME) {
    throw new Error("The expected Cloudflare Pages project was not found");
  }

  await cloudflareRequest(accountId, token, `/pages/projects/${PROJECT_NAME}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  const configuredProject = await cloudflareRequest(
    accountId,
    token,
    `/pages/projects/${PROJECT_NAME}`,
  );
  assertProjectConfigured(configuredProject, databaseId);

  const deployments = await cloudflareRequest(
    accountId,
    token,
    `/pages/projects/${PROJECT_NAME}/deployments?env=production&page=1&per_page=20`,
  );
  const latestSuccessful = deployments.find(
    (deployment) => deployment?.environment === "production"
      && deployment?.latest_stage?.status === "success"
      && !deployment?.is_skipped,
  );
  if (!latestSuccessful?.id) {
    throw new Error("No successful production deployment is available to retry");
  }

  const retried = await cloudflareRequest(
    accountId,
    token,
    `/pages/projects/${PROJECT_NAME}/deployments/${latestSuccessful.id}/retry`,
    { method: "POST" },
  );
  if (!retried?.id) throw new Error("Cloudflare did not return a retry deployment ID");
  await waitForDeployment(accountId, token, retried.id);
  await waitForPublicConfig();
  await writeSummary();
  console.log("NCC test payment infrastructure is enabled and verified.");
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "NCC payment provisioning failed");
    process.exitCode = 1;
  });
}
