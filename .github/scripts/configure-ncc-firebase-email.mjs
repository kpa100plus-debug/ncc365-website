import { createSign } from "node:crypto";
import { pathToFileURL } from "node:url";

const PROJECT_ID = "ncc-member";
const CONFIG_URL = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`;
const EXPECTED_SUBJECT = "NCC 회원 비밀번호 재설정 안내";
const EXPECTED_CALLBACK = "https://ncc365.com/password-reset.html";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function koreanResetTemplate(current = {}) {
  return {
    ...current,
    subject: EXPECTED_SUBJECT,
    senderDisplayName: "전국소비자클럽 NCC",
    bodyFormat: "HTML",
    body: '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#173b34"><img src="https://ncc365.com/images/NCC_HEADER.webp" alt="전국소비자클럽 NCC" style="width:220px;max-width:70%;height:auto"><h1 style="font-size:24px">NCC 회원 비밀번호 재설정 안내</h1><p>요청하신 NCC 회원 비밀번호 재설정을 진행하려면 아래 버튼을 눌러 주세요.</p><p><a href="%LINK%" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#d5ab4c;color:#092822;text-decoration:none;font-weight:600">비밀번호 재설정</a></p><p>본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p><p>전국소비자클럽(NCC)</p></div>',
  };
}

export function assertKoreanResetConfig(config) {
  const sendEmail = config?.notification?.sendEmail;
  const template = sendEmail?.resetPasswordTemplate;
  if (config?.notification?.defaultLocale !== "ko") throw new Error("Firebase default email locale is not Korean");
  if (sendEmail?.callbackUri !== EXPECTED_CALLBACK) throw new Error("Firebase reset callback does not use the NCC reset screen");
  if (template?.subject !== EXPECTED_SUBJECT || template?.bodyFormat !== "HTML") throw new Error("Firebase reset template is not the NCC Korean template");
  if (!template?.body?.includes("%LINK%") || !template.body.includes("NCC_HEADER.webp")) throw new Error("Firebase reset template is missing the one-time link or official NCC logo");
}

function serviceAccount() {
  let parsed;
  try { parsed = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || ""); } catch { throw new Error("Firebase administrator service account JSON is invalid"); }
  if (parsed?.project_id !== PROJECT_ID || !parsed?.client_email || !parsed?.private_key) throw new Error("Firebase administrator service account does not match ncc-member");
  return parsed;
}

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error("Firebase administrator OAuth token could not be issued");
  return body.access_token;
}

async function firebaseConfig(token, init = {}) {
  const response = await fetch(init.method ? `${CONFIG_URL}?updateMask=notification.sendEmail.resetPasswordTemplate,notification.sendEmail.callbackUri,notification.defaultLocale` : CONFIG_URL, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = String(body?.error?.status || "UNKNOWN").replace(/[^A-Z0-9_]/g, "").slice(0, 80);
    const message = String(body?.error?.message || "request rejected").replace(/[\r\n]+/g, " ").slice(0, 500);
    const violations = Array.isArray(body?.error?.details)
      ? body.error.details.flatMap(detail => detail?.fieldViolations || []).map(item => String(item?.field || "").slice(0, 160)).filter(Boolean).join(",")
      : "";
    throw new Error(`Firebase email configuration request failed (HTTP ${response.status}, ${status}${violations ? `, fields: ${violations}` : ""}): ${message}`);
  }
  return body;
}

async function main() {
  const token = await accessToken(serviceAccount());
  const current = await firebaseConfig(token);
  const sendEmail = current.notification?.sendEmail || {};
  await firebaseConfig(token, {
    method: "PATCH",
    body: JSON.stringify({ notification: { defaultLocale: "ko", sendEmail: { callbackUri: EXPECTED_CALLBACK, resetPasswordTemplate: koreanResetTemplate(sendEmail.resetPasswordTemplate) } } }),
  });
  const verified = await firebaseConfig(token);
  assertKoreanResetConfig(verified);
  console.log("NCC Korean Firebase password-reset email is configured and verified.");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Firebase email configuration failed"); process.exitCode = 1; });
}
