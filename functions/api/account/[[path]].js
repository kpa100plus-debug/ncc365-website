const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const MEMBER_NUMBER_PATTERN = /^NCC-C-[0-9]{6}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STATUS_LABELS = {
  active: "정상 활동",
  paused: "일시정지",
  blocked: "일시정지",
  withdrawal_pending: "일시정지",
  withdrawn: "탈퇴 또는 만료",
};
const MEMBER_TYPE_LABELS = {
  consumer: "소비자회원",
  center_manager: "센터장",
  center_staff: "센터 팀원",
  partner: "기업·소상공인 파트너",
  corporate: "기업 파트너",
  soleProprietor: "소상공인 파트너",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function apiError(status, code, message) {
  return json({ ok: false, code, message }, status);
}

class AccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

async function readJson(request, maximumBytes = 262_144) {
  const contentType = request.headers.get("content-type") || "";
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AccountError(415, "CONTENT_TYPE_REQUIRED", "JSON 요청만 허용됩니다.");
  }
  if (contentLength > maximumBytes) {
    throw new AccountError(413, "PAYLOAD_TOO_LARGE", "요청 데이터가 너무 큽니다.");
  }
  try {
    return await request.json();
  } catch {
    throw new AccountError(400, "INVALID_JSON", "요청 내용을 확인해 주세요.");
  }
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new AccountError(401, "LOGIN_REQUIRED", "관리자 로그인이 필요합니다.");
  return match[1];
}

async function verifyAdmin(request, env) {
  if (!env.FIREBASE_API_KEY || !env.ADMIN_EMAIL) {
    throw new AccountError(503, "AUTH_NOT_CONFIGURED", "관리자 인증 설정이 완료되지 않았습니다.");
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: bearerToken(request) }),
    },
  );
  if (!response.ok) throw new AccountError(401, "INVALID_LOGIN", "관리자 로그인이 만료되었습니다.");
  const body = await response.json();
  const user = body.users?.[0];
  const email = String(user?.email || "").toLowerCase();
  if (!user?.localId || user.disabled || email !== String(env.ADMIN_EMAIL).trim().toLowerCase()) {
    throw new AccountError(403, "ADMIN_REQUIRED", "NCC 관리자 권한이 필요합니다.");
  }
  return { uid: user.localId, email };
}

function normalizeMemberNumber(value) {
  return String(value || "").trim().toUpperCase().replace(/[–—−]/g, "-").replace(/\s+/g, "");
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function maskName(value) {
  const name = String(value || "").trim();
  if (!name) return "회원";
  const characters = [...name];
  if (characters.length === 1) return `${characters[0]}○`;
  if (characters.length === 2) return `${characters[0]}○`;
  return `${characters[0]}${"○".repeat(Math.min(3, characters.length - 2))}${characters.at(-1)}`;
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(4, Math.max(1, local.length - 1)));
  return `${visible}${"*".repeat(Math.max(4, local.length - visible.length))}@${domain}`;
}

function safeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function recoveryLookupHash(name, phone) {
  return sha256(`${normalizeName(name)}|${normalizePhone(phone)}`);
}

function memberVerificationView(row) {
  return {
    kind: "member",
    type: MEMBER_TYPE_LABELS[row.member_type] || "NCC 회원",
    number: row.member_number,
    name: row.masked_name,
    status: row.status_label,
    joinedAt: row.joined_at || "",
    valid: Boolean(row.valid),
    issuer: "전국소비자클럽(NCC)",
  };
}

async function verifyMember(url, env) {
  const memberNumber = normalizeMemberNumber(url.searchParams.get("id"));
  if (!MEMBER_NUMBER_PATTERN.test(memberNumber)) {
    throw new AccountError(400, "INVALID_MEMBER_NUMBER", "회원번호 형식을 확인해 주세요.");
  }
  const row = await env.NCC_PAYMENTS.prepare(
    "SELECT member_number, member_type, masked_name, status_label, joined_at, valid FROM member_verifications WHERE member_number = ?1",
  ).bind(memberNumber).first();
  if (!row) throw new AccountError(404, "MEMBER_NOT_FOUND", "일치하는 회원기록이 없습니다.");
  return json({ ok: true, verification: memberVerificationView(row) });
}

function recoveryClientKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const agent = (request.headers.get("user-agent") || "unknown").slice(0, 160);
  return `${ip}|${agent}`;
}

async function enforceRecoveryLimit(request, env) {
  const key = await sha256(recoveryClientKey(request));
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const existing = await env.NCC_PAYMENTS.prepare(
    "SELECT attempt_count, window_started_at, locked_until FROM account_recovery_attempts WHERE client_hash = ?1",
  ).bind(key).first();
  if (existing?.locked_until && Date.parse(existing.locked_until) > now) {
    throw new AccountError(429, "RECOVERY_RATE_LIMIT", "요청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.");
  }
  const currentWindow = Date.parse(existing?.window_started_at || "");
  const count = Number(existing?.attempt_count || 0);
  if (Number.isFinite(currentWindow) && currentWindow >= windowStart && count >= 5) {
    const lockedUntil = new Date(now + 30 * 60 * 1000).toISOString();
    await env.NCC_PAYMENTS.prepare(
      "UPDATE account_recovery_attempts SET locked_until = ?1, updated_at = ?2 WHERE client_hash = ?3",
    ).bind(lockedUntil, new Date(now).toISOString(), key).run();
    throw new AccountError(429, "RECOVERY_RATE_LIMIT", "요청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.");
  }
  const nextCount = Number.isFinite(currentWindow) && currentWindow >= windowStart ? count + 1 : 1;
  const startedAt = nextCount === 1 ? new Date(now).toISOString() : existing.window_started_at;
  await env.NCC_PAYMENTS.prepare(
    "INSERT INTO account_recovery_attempts (client_hash, attempt_count, window_started_at, locked_until, updated_at) VALUES (?1, ?2, ?3, NULL, ?4) ON CONFLICT(client_hash) DO UPDATE SET attempt_count = excluded.attempt_count, window_started_at = excluded.window_started_at, locked_until = NULL, updated_at = excluded.updated_at",
  ).bind(key, nextCount, startedAt, new Date(now).toISOString()).run();
}

async function recoverEmail(request, env) {
  await enforceRecoveryLimit(request, env);
  const body = await readJson(request, 4096);
  const name = normalizeName(body.name);
  const phone = normalizePhone(body.phone);
  if (name.length < 1 || name.length > 50 || !/^[0-9]{9,11}$/.test(phone)) {
    throw new AccountError(400, "INVALID_RECOVERY_INPUT", "이름과 9~11자리 연락처를 확인해 주세요.");
  }
  const lookupHash = await recoveryLookupHash(name, phone);
  const row = await env.NCC_PAYMENTS.prepare(
    "SELECT masked_email, status FROM member_recovery_index WHERE lookup_hash = ?1",
  ).bind(lookupHash).first();
  if (!row || row.status !== "active") {
    return json({ ok: true, found: false, message: "일치하는 활성 회원정보를 확인하지 못했습니다. 관리자에게 확인을 요청해 주세요." });
  }
  return json({ ok: true, found: true, maskedEmail: row.masked_email });
}

async function syncIndexes(request, env, admin) {
  const body = await readJson(request);
  const members = Array.isArray(body.members) ? body.members : [];
  if (!members.length || members.length > 500) {
    throw new AccountError(400, "INVALID_MEMBER_BATCH", "동기화할 회원 범위를 확인해 주세요.");
  }
  const statements = [];
  const now = new Date().toISOString();
  let verificationCount = 0;
  let recoveryCount = 0;
  for (const item of members) {
    const memberNumber = normalizeMemberNumber(item.memberNumber);
    if (!MEMBER_NUMBER_PATTERN.test(memberNumber)) continue;
    const status = String(item.status || "active");
    const statusLabel = STATUS_LABELS[status] || "일시정지";
    const valid = status === "active" ? 1 : 0;
    const memberType = Object.prototype.hasOwnProperty.call(MEMBER_TYPE_LABELS, item.memberType) ? item.memberType : "consumer";
    statements.push(env.NCC_PAYMENTS.prepare(
      "INSERT INTO member_verifications (member_number, member_type, masked_name, status, status_label, joined_at, valid, synced_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(member_number) DO UPDATE SET member_type = excluded.member_type, masked_name = excluded.masked_name, status = excluded.status, status_label = excluded.status_label, joined_at = excluded.joined_at, valid = excluded.valid, synced_at = excluded.synced_at",
    ).bind(memberNumber, memberType, maskName(item.name), status, statusLabel, safeDate(item.joinedAt), valid, now));
    verificationCount += 1;
    const email = normalizeEmail(item.email);
    const phone = normalizePhone(item.phone);
    const name = normalizeName(item.name);
    if (EMAIL_PATTERN.test(email) && /^[0-9]{9,11}$/.test(phone) && name) {
      const lookupHash = await recoveryLookupHash(name, phone);
      statements.push(env.NCC_PAYMENTS.prepare(
        "INSERT INTO member_recovery_index (lookup_hash, masked_email, status, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(lookup_hash) DO UPDATE SET masked_email = excluded.masked_email, status = excluded.status, updated_at = excluded.updated_at",
      ).bind(lookupHash, maskEmail(email), status, now));
      recoveryCount += 1;
    }
  }
  for (let start = 0; start < statements.length; start += 80) {
    await env.NCC_PAYMENTS.batch(statements.slice(start, start + 80));
  }
  await env.NCC_PAYMENTS.prepare(
    "INSERT INTO account_admin_audit (id, action, actor_uid, actor_email, target_member_number, before_value, after_value, reason, success, created_at) VALUES (?1, 'index_sync', ?2, ?3, '', '', ?4, '관리자 회원목록 동기화', 1, ?5)",
  ).bind(crypto.randomUUID(), admin.uid, admin.email, `${verificationCount}/${recoveryCount}`, now).run();
  return json({ ok: true, verificationCount, recoveryCount });
}

async function sendPasswordReset(email, env) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-firebase-locale": "ko" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        continueUrl: "https://ncc365.com/password-reset.html",
      }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = String(body?.error?.message || "");
    if (code.includes("EMAIL_NOT_FOUND")) throw new AccountError(404, "ACCOUNT_NOT_FOUND", "등록 계정을 찾을 수 없습니다.");
    throw new AccountError(502, "RESET_EMAIL_FAILED", "비밀번호 재설정 메일을 보내지 못했습니다.");
  }
}

async function adminResetPassword(request, env, admin) {
  const body = await readJson(request, 8192);
  const email = normalizeEmail(body.email);
  const memberNumber = normalizeMemberNumber(body.memberNumber);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (!EMAIL_PATTERN.test(email) || !MEMBER_NUMBER_PATTERN.test(memberNumber) || !reason) {
    throw new AccountError(400, "INVALID_ACCOUNT_ACTION", "회원정보와 처리 사유를 확인해 주세요.");
  }
  let success = 0;
  try {
    await sendPasswordReset(email, env);
    success = 1;
    return json({ ok: true, message: "한글 비밀번호 재설정 메일을 발송했습니다." });
  } finally {
    await env.NCC_PAYMENTS.prepare(
      "INSERT INTO account_admin_audit (id, action, actor_uid, actor_email, target_member_number, before_value, after_value, reason, success, created_at) VALUES (?1, 'password_reset_sent', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    ).bind(crypto.randomUUID(), admin.uid, admin.email, memberNumber, maskEmail(email), "재설정 메일 발송", reason, success, new Date().toISOString()).run();
  }
}

function accountManagementConfigured(env) {
  try {
    const account = JSON.parse(String(env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON || ""));
    return Boolean(account?.client_email && account?.private_key);
  } catch {
    return false;
  }
}

function base64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8Base64Url(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem) {
  const body = String(pem || "").replace(/-{5}(?:BEGIN|END)\s+PRIVATE\s+KEY-{5}|\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function googleAccessToken(env) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new AccountError(503, "FIREBASE_ADMIN_NOT_CONFIGURED", "Firebase 관리자 계정연결이 필요합니다.");
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new AccountError(503, "FIREBASE_ADMIN_NOT_CONFIGURED", "Firebase 관리자 계정연결이 필요합니다.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = utf8Base64Url({ alg: "RS256", typ: "JWT" });
  const payload = utf8Base64Url({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/identitytoolkit",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new AccountError(503, "FIREBASE_ADMIN_AUTH_FAILED", "Firebase 관리자 인증에 실패했습니다.");
  }
  return body.access_token;
}

async function updateFirebaseAccount(env, payload) {
  const token = await googleAccessToken(env);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID || "ncc-member")}/accounts:update`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...payload, returnSecureToken: false }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(body?.error?.message || "");
    if (code.includes("EMAIL_EXISTS")) throw new AccountError(409, "EMAIL_IN_USE", "이미 사용 중인 이메일입니다.");
    if (code.includes("USER_NOT_FOUND")) throw new AccountError(404, "ACCOUNT_NOT_FOUND", "Firebase 로그인 계정을 찾을 수 없습니다.");
    throw new AccountError(502, "FIREBASE_ACCOUNT_UPDATE_FAILED", "Firebase 로그인 계정을 변경하지 못했습니다.");
  }
  return body;
}

function koreanResetTemplate(current = {}) {
  return {
    ...current,
    subject: "NCC 회원 비밀번호 재설정 안내",
    senderDisplayName: "전국소비자클럽 NCC",
    bodyFormat: "HTML",
    body: '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#173b34"><img src="https://ncc365.com/images/NCC_HEADER.webp" alt="전국소비자클럽 NCC" style="width:220px;max-width:70%;height:auto"><h1 style="font-size:24px">NCC 회원 비밀번호 재설정 안내</h1><p>요청하신 NCC 회원 비밀번호 재설정을 진행하려면 아래 버튼을 눌러 주세요.</p><p><a href="%LINK%" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#d5ab4c;color:#092822;text-decoration:none;font-weight:600">비밀번호 재설정</a></p><p>본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p><p>전국소비자클럽(NCC)</p></div>',
  };
}

async function configureKoreanResetTemplate(env) {
  const token = await googleAccessToken(env);
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID || "ncc-member");
  const endpoint = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  const currentResponse = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
  const current = await currentResponse.json().catch(() => ({}));
  if (!currentResponse.ok) throw new AccountError(502, "FIREBASE_TEMPLATE_READ_FAILED", "현재 이메일 설정을 확인하지 못했습니다.");
  const sendEmail = current.notification?.sendEmail || {};
  const response = await fetch(`${endpoint}?updateMask=notification.sendEmail.resetPasswordTemplate,notification.sendEmail.callbackUri,notification.defaultLocale`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      notification: {
        defaultLocale: "ko",
        sendEmail: {
          callbackUri: "https://ncc365.com/password-reset.html",
          resetPasswordTemplate: koreanResetTemplate(sendEmail.resetPasswordTemplate),
        },
      },
    }),
  });
  if (!response.ok) throw new AccountError(502, "FIREBASE_TEMPLATE_UPDATE_FAILED", "NCC 한글 비밀번호 재설정 메일 설정을 적용하지 못했습니다.");
}

async function adminConfigureResetTemplate(request, env, admin) {
  await readJson(request, 2048);
  let success = 0;
  try {
    await configureKoreanResetTemplate(env);
    success = 1;
    return json({ ok: true, message: "NCC 한글 비밀번호 재설정 메일 설정을 적용했습니다." });
  } finally {
    await env.NCC_PAYMENTS.prepare(
      "INSERT INTO account_admin_audit (id, action, actor_uid, actor_email, target_member_number, before_value, after_value, reason, success, created_at) VALUES (?1, 'reset_template_configured', ?2, ?3, '', '', 'NCC 한글 재설정 메일', '공식 한글 비밀번호 재설정 구성', ?4, ?5)",
    ).bind(crypto.randomUUID(), admin.uid, admin.email, success, new Date().toISOString()).run();
  }
}

async function adminUpdateEmail(request, env, admin) {
  const body = await readJson(request, 8192);
  const uid = String(body.uid || "").trim();
  const memberNumber = normalizeMemberNumber(body.memberNumber);
  const beforeEmail = normalizeEmail(body.beforeEmail);
  const nextEmail = normalizeEmail(body.email);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !MEMBER_NUMBER_PATTERN.test(memberNumber)
      || !EMAIL_PATTERN.test(beforeEmail) || !EMAIL_PATTERN.test(nextEmail) || beforeEmail === nextEmail || !reason) {
    throw new AccountError(400, "INVALID_ACCOUNT_ACTION", "회원 이메일과 처리 사유를 확인해 주세요.");
  }
  let success = 0;
  try {
    await updateFirebaseAccount(env, { localId: uid, email: nextEmail, emailVerified: false });
    success = 1;
    return json({ ok: true, beforeEmail, email: nextEmail });
  } finally {
    await env.NCC_PAYMENTS.prepare(
      "INSERT INTO account_admin_audit (id, action, actor_uid, actor_email, target_member_number, before_value, after_value, reason, success, created_at) VALUES (?1, 'email_updated', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    ).bind(crypto.randomUUID(), admin.uid, admin.email, memberNumber, maskEmail(beforeEmail), maskEmail(nextEmail), reason, success, new Date().toISOString()).run();
  }
}

function temporaryPassword() {
  // Firebase Auth requires at least six characters. A numeric six-digit
  // one-time password keeps entry simple while avoiding predictable values.
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(100000 + Math.floor((value / 0x100000000) * 900000));
}

async function adminTemporaryPassword(request, env, admin) {
  const body = await readJson(request, 8192);
  const uid = String(body.uid || "").trim();
  const memberNumber = normalizeMemberNumber(body.memberNumber);
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !MEMBER_NUMBER_PATTERN.test(memberNumber) || !reason) {
    throw new AccountError(400, "INVALID_ACCOUNT_ACTION", "회원계정과 처리 사유를 확인해 주세요.");
  }
  const password = temporaryPassword();
  let success = 0;
  try {
    await updateFirebaseAccount(env, { localId: uid, password, validSince: String(Math.floor(Date.now() / 1000)) });
    success = 1;
    return json({ ok: true, temporaryPassword: password });
  } finally {
    await env.NCC_PAYMENTS.prepare(
      "INSERT INTO account_admin_audit (id, action, actor_uid, actor_email, target_member_number, before_value, after_value, reason, success, created_at) VALUES (?1, 'temporary_password_issued', ?2, ?3, ?4, '기존 비밀번호 비공개', '임시 비밀번호 발급', ?5, ?6, ?7)",
    ).bind(crypto.randomUUID(), admin.uid, admin.email, memberNumber, reason, success, new Date().toISOString()).run();
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!allowedOrigin(request)) return apiError(403, "ORIGIN_DENIED", "허용되지 않은 요청 출처입니다.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
  if (!env.NCC_PAYMENTS) return apiError(503, "DATABASE_NOT_BOUND", "계정 복구 데이터베이스 연결이 필요합니다.");
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/account\/?/, "").replace(/\/$/, "");
  try {
    if (request.method === "GET" && route === "config") {
      return json({ ok: true, emailRecovery: true, adminAccountManagement: accountManagementConfigured(env) });
    }
    if (request.method === "GET" && route === "verify") return await verifyMember(url, env);
    if (request.method === "POST" && route === "recover-email") return await recoverEmail(request, env);
    const admin = await verifyAdmin(request, env);
    if (request.method === "POST" && route === "admin/sync") return await syncIndexes(request, env, admin);
    if (request.method === "POST" && route === "admin/configure-reset-template") return await adminConfigureResetTemplate(request, env, admin);
    if (request.method === "POST" && route === "admin/reset-password") return await adminResetPassword(request, env, admin);
    if (request.method === "POST" && route === "admin/update-email") return await adminUpdateEmail(request, env, admin);
    if (request.method === "POST" && route === "admin/temporary-password") return await adminTemporaryPassword(request, env, admin);
    return apiError(404, "NOT_FOUND", "요청한 계정 기능을 찾을 수 없습니다.");
  } catch (error) {
    if (error instanceof AccountError) return apiError(error.status, error.code, error.message);
    console.error(JSON.stringify({ event: "account_api_error", route, message: String(error?.message || error).slice(0, 300) }));
    return apiError(500, "ACCOUNT_SERVER_ERROR", "계정 처리 중 오류가 발생했습니다.");
  }
}

export const __test = {
  accountManagementConfigured,
  allowedOrigin,
  maskEmail,
  maskName,
  memberVerificationView,
  koreanResetTemplate,
  normalizeEmail,
  normalizeMemberNumber,
  normalizeName,
  normalizePhone,
  temporaryPassword,
};
