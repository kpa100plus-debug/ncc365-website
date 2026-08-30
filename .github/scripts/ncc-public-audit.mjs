import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const playwrightModule = process.env.NCC_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);

let baseUrl = (process.env.NCC_BASE_URL || "https://ncc365.com").replace(/\/$/, "");
const outputDir = process.env.NCC_AUDIT_OUTPUT || "artifacts/public-audit";
const phase = process.env.NCC_AUDIT_PHASE || "audit";
const screenshotMode = process.env.NCC_AUDIT_SCREENSHOTS || "all";
const expectedFont = "Noto Sans KR Variable";
const allowedWeights = new Set(["400", "500", "600"]);
const notFoundAuditRoute = "/__ncc-audit-not-found__";

async function loadRedirectRules(rootDir) {
  try {
    const source = await readFile(path.join(rootDir, "_redirects"), "utf8");
    return source
      .split(/\r?\n/)
      .map(line => line.replace(/\s+#.*$/, "").trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => {
        const [from, to, rawStatus = "302"] = line.split(/\s+/);
        return { from, to, status: Number(rawStatus) || 302 };
      })
      .filter(rule => rule.from?.startsWith("/") && rule.to?.startsWith("/"));
  } catch {
    return [];
  }
}

async function discoverHtmlRoutes(rootDir) {
  const ignoredDirectories = new Set([".git", "artifacts", "coverage", "node_modules"]);
  const discovered = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
      discovered.push(relativePath === "index.html" ? "/" : `/${relativePath}`);
    }
  }

  await visit(rootDir);
  return discovered.sort((left, right) => left.localeCompare(right, "en"));
}

const discoveredRoutes = await discoverHtmlRoutes(process.cwd());
const redirectRules = await loadRedirectRules(process.cwd());
const redirectRuleBySource = new Map(redirectRules.map(rule => [rule.from, rule]));
const dynamicRoutes = Array.from({ length: 11 }, (_, index) => `/consumer-on.html?page=${index + 2}`);
const routes = [...new Set([...discoveredRoutes, "/profile", "/admin-payments", ...dynamicRoutes, notFoundAuditRoute])];

const coreRoutes = [
  "/", "/join.html", "/wallet.html", "/profile", "/benefits.html", "/benefit-detail.html",
  "/groupbuy.html", "/groupbuy-detail.html", "/consumer-channel.html", "/consumer-on.html",
  "/payment-checkout.html", "/payment-result.html", "/admin.html", "/admin-applications.html",
  "/admin-business-cards.html", "/admin-payments",
];

const viewports = [
  { name: "pc-1440", width: 1440, height: 1000 },
  { name: "pc-1280", width: 1280, height: 900 },
  { name: "landscape-932", width: 932, height: 430 },
  { name: "landscape-844", width: 844, height: 390 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-412", width: 412, height: 915 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-375", width: 375, height: 812 },
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-320", width: 320, height: 568 },
];

const requestedRoutes = (process.env.NCC_AUDIT_ROUTES || "").split(",").map(value => value.trim()).filter(Boolean);
const requestedWidths = (process.env.NCC_AUDIT_WIDTHS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);
const auditedRoutes = requestedRoutes.length ? requestedRoutes : routes;
const auditState = process.env.NCC_AUDIT_STATE === "protected" ? "protected" : "public";

const routeViewports = auditedRoutes.flatMap(route => {
  const selected = viewports;
  const filtered = requestedWidths.length ? selected.filter(viewport => requestedWidths.includes(viewport.width)) : selected;
  return filtered.map(viewport => ({ route, viewport }));
});
const auditConcurrency = Math.min(6, Math.max(1, Number(process.env.NCC_AUDIT_CONCURRENCY) || 4));

function fileKey(route) {
  const url = new URL(route, "https://ncc.local");
  if (url.pathname === "/") return "home";
  const extensionlessRoute = !url.pathname.endsWith(".html") ? "-route" : "";
  const pathname = url.pathname.replace(/^\//, "").replace(/\.html$/, "");
  const query = url.search ? `-${url.search.slice(1)}` : "";
  return `${pathname}${extensionlessRoute}${query}`.replace(/[^a-z0-9-]+/gi, "-");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

await mkdir(path.join(outputDir, "screenshots"), { recursive: true });

let localServer;
if (process.env.NCC_SERVE_DIR) {
  const serveRoot = path.resolve(process.env.NCC_SERVE_DIR);
  const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  localServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      const redirectRule = redirectRuleBySource.get(pathname);
      if (redirectRule) {
        response.writeHead(redirectRule.status, { location: `${redirectRule.to}${url.search}` });
        response.end();
        return;
      }
      if (pathname === "/") pathname = "/index.html";
      let filePath = path.resolve(serveRoot, `.${pathname}`);
      if (!filePath.startsWith(`${serveRoot}${path.sep}`)) throw new Error("invalid path");
      try {
        if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      } catch {
        if (!path.extname(filePath)) filePath = `${filePath}.html`;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=()",
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch {
      try {
        const body = await readFile(path.join(serveRoot, "404.html"));
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        response.end(body);
      } catch {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      }
    }
  });
  await new Promise(resolve => localServer.listen(0, "127.0.0.1", resolve));
  const address = localServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

const browser = await chromium.launch({ headless: true });
const results = [];

for (let offset = 0; offset < routeViewports.length; offset += auditConcurrency) {
  const batch = routeViewports.slice(offset, offset + auditConcurrency);
  await Promise.all(batch.map(async ({ route, viewport }) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    locale: "ko-KR",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];
  const redirects = [];

  if (process.env.NCC_LOCAL_FONT_DIR) {
    const localFontDir = path.resolve(process.env.NCC_LOCAL_FONT_DIR);
    await page.route("https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-kr@5.3.0/files/*", async route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      try {
        await route.fulfill({
          status: 200,
          contentType: "font/woff2",
          body: await readFile(path.join(localFontDir, filename)),
        });
      } catch {
        await route.abort("failed");
      }
    });
  }

  page.on("console", message => {
    if (message.type() === "error") {
      const sourceUrl = message.location().url;
      consoleErrors.push(`${message.text()}${sourceUrl ? ` @ ${sourceUrl}` : ""}`.slice(0, 700));
    }
  });
  page.on("pageerror", error => pageErrors.push(String(error.message || error).slice(0, 500)));
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`.slice(0, 700));
  });
  page.on("response", response => {
    const url = response.url();
    const expectedNotFound = new URL(route, "https://ncc.local").pathname === notFoundAuditRoute
      && response.status() === 404
      && new URL(url).pathname === notFoundAuditRoute;
    if (!expectedNotFound && response.status() >= 400 && (url.startsWith(baseUrl) || /fonts\.(googleapis|gstatic)\.com/.test(url))) {
      badResponses.push(`${response.status()} ${url}`.slice(0, 700));
    }
  });

  let response;
  let navigationError = "";
  let statePreparation = { state: auditState, applied: auditState === "public", revealed: [] };
  try {
    response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.waitForTimeout(500);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(350);
        break;
      } catch (error) {
        if (!/Execution context was destroyed/i.test(String(error?.message || error)) || attempt === 2) throw error;
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      }
    }
  } catch (error) {
    navigationError = String(error.message || error).slice(0, 700);
  }

  if (!navigationError && auditState === "protected") {
    try {
      statePreparation = await page.evaluate(() => {
        const pathname = location.pathname.replace(/\/$/, "") || "/";
        const variant = new URL(location.href).searchParams.get("__ncc_variant") || "";
        const revealed = [];
        const show = selector => {
          document.querySelectorAll(selector).forEach(element => {
            element.hidden = false;
            if (element.style.display === "none") element.style.removeProperty("display");
            if (getComputedStyle(element).display === "none") {
              element.style.display = element.classList.contains("modal-backdrop") ? "flex" : "block";
            }
            revealed.push(selector);
          });
        };
        const hide = selector => {
          document.querySelectorAll(selector).forEach(element => {
            element.hidden = true;
            element.style.display = "none";
          });
        };
        const text = (selector, value) => {
          const element = document.querySelector(selector);
          if (element) element.textContent = value;
        };
        const value = (selector, nextValue) => {
          const element = document.querySelector(selector);
          if (element && "value" in element) element.value = nextValue;
        };
        const markup = (selector, html) => {
          const element = document.querySelector(selector);
          if (element) element.innerHTML = html;
        };
        const sampleApplication = (title = "모바일 화면 검증 신청") => `<article class="application-card"><div><h2>${title}</h2><div class="meta"><span>접수번호 NCC-AUDIT-0001</span><span>서울특별시</span><span>2026. 8. 30.</span></div><p class="message">운영 데이터를 변경하지 않는 합성 레이아웃 검증 항목입니다.</p></div><div class="card-actions"><select aria-label="검증 항목 상태"><option>확인 중</option></select><button type="button">상태 저장</button></div></article>`;

        hide("#loginArea, #adminAccountLogin, #adminOperationLogin, #adminRoleLogin, #authGate, #walletLoading, #roleLoading, #profileStatus, #productLoading, #orderDetailLoading, #checkoutLoading, #checkoutUnavailable, #resultLoading");

        if (pathname === "/wallet.html") {
          show("#memberArea");
          text("#memberName", "김소비");
          text("#memberNumber", "NCC-C-000016");
          text("#memberType", "일반회원");
          text("#memberRegion", "서울특별시");
          text("#memberSince", "NCC MEMBER · 2026");
          text("#memberContact", "010-0000-0000 · member@example.com");
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = "css/wallet-activity.css?v=20260830-1";
          document.head.append(link);
          const logout = document.querySelector("#memberArea .logout-button");
          logout?.insertAdjacentHTML("beforebegin", `<section id="walletActivity" class="wallet-activity"><div class="wallet-activity-head"><div><p class="eyebrow">MY ACTIVITY</p><h2>알림·신청·주문·배송·후기</h2></div><div class="wallet-activity-tabs" role="tablist" aria-label="월렛 이용내역 구분"><button class="active">전체</button><button>알림함</button><button>혜택</button><button>공동구매</button><button>후기 가능</button></div></div><p class="wallet-notice-guide">혜택 모집·처리상태 안내는 이 알림함에 표시됩니다.</p><div class="wallet-activity-summary"><div><span>월렛 알림</span><b>1</b></div><div><span>혜택 신청</span><b>2</b></div><div><span>공동구매 주문</span><b>1</b></div><div><span>배송 중</span><b>1</b></div><div><span>후기 가능</span><b>1</b></div></div><div class="wallet-activity-list"><article class="wallet-record wallet-notification"><div><small>NCC WALLET NOTICE · 2026. 8. 30.</small><h3>혜택 신청 상태 안내</h3><p>신청한 혜택이 확인 중입니다.</p><div class="wallet-record-meta"><span class="wallet-status">확인 중</span><span>NCC 회원 혜택</span></div></div><div class="wallet-record-action"><a href="benefits.html">혜택 상세 보기</a></div></article><article class="wallet-record"><div><small>GROUP BUY · NCC-AUDIT-0001</small><h3>공동구매 주문</h3><p>수량 1개 · 10,000원</p><div class="wallet-record-meta"><span class="wallet-status">배송 중</span><span>2026. 8. 30.</span></div></div><div class="wallet-record-action"><a href="profile.html#groupbuy-orders">상세 보기</a><a href="groupbuy.html">이용 후기 작성</a></div></article></div></section>`);
          if (variant === "back") document.querySelector("#memberCard")?.classList.add("is-flipped");
        }

        if (pathname === "/profile.html" || pathname === "/profile") {
          show("#basicForm, #profileForm, #groupBuyOrderSection, #addressSection, #securitySection, #withdrawSection");
          value("#basicName", "김소비");
          value("#basicPhone", "010-0000-0000");
          value("#basicRegion", "서울특별시 중구");
          value("#basicEmail", "member@example.com");
          markup("#groupBuyOrderList", `<article class="groupbuy-order-card"><div><strong>공동구매 주문</strong><p>NCC-AUDIT-0001 · 배송 중</p></div><a class="ncc-button" href="order-detail.html">주문 상세</a></article>`);
          markup("#addressList", `<article class="address-card"><div><strong>기본 배송지 · 집</strong><p>김소비 · 서울특별시 중구 세종대로 1</p></div><button class="mini-button" type="button">수정</button></article>`);
          if (variant === "address") show("#addressForm");
        }

        if (["/center-dashboard.html", "/partner-dashboard.html"].includes(pathname)) {
          show("#roleContent");
          text("#roleLabel", pathname.includes("center") ? "센터장" : "파트너회원");
          text("#roleName", "김소비");
          text("#roleNumber", "NCC-C-000016");
          text("#roleOrganization", pathname.includes("center") ? "서울중앙소비자센터" : "NCC 협력 파트너");
          text("#roleRegion", "서울특별시");
          markup("#operationList", `<article class="operation-item"><div><strong>운영 제안 검토</strong><p>지역 회원을 위한 모바일 화면 검증 항목</p></div><span>확인 중</span></article>`);
        }

        if (/^\/admin-(applications|certificates|groupbuy|inquiries|payments)(?:\.html)?$/.test(pathname)) {
          show("#adminArea");
          markup("#applicationList", sampleApplication("혜택 신청 검증"));
          markup("#certificateList", sampleApplication("인증서 발급 검증"));
          markup("#productList", sampleApplication("공동구매 상품 검증"));
          markup("#orderList", sampleApplication("공동구매 주문 검증"));
          markup("#paymentList", sampleApplication("결제·환불 검증"));
          text("#paymentModeWarning", "테스트 모드 · 실결제 없음");
          if (pathname === "/admin-certificates.html" && variant === "form") show("#certificateForm");
          if (pathname === "/admin-groupbuy.html" && variant === "form") show("#productForm");
          if (pathname === "/admin-groupbuy.html" && variant === "orders") {
            hide("#productsPanel");
            show("#ordersPanel");
          }
        }

        if (pathname === "/admin-feedback.html") {
          show("#adminArea");
          markup("#feedbackStats", `<article><span>기대평</span><b>1</b></article><article><span>후기</span><b>1</b></article><article><span>신고</span><b>0</b></article>`);
          markup("#feedbackList", `<article class="platform-card"><span class="badge">이용 후기</span><h3>모바일 후기 관리 검증</h3><p>운영 데이터를 변경하지 않는 합성 표시 항목입니다.</p><button class="ncc-button" type="button">공개 상태 변경</button></article>`);
        }

        if (pathname === "/admin-business-cards.html") {
          show("#studioApp");
          if (variant === "portrait") {
            document.querySelector("#previewSet")?.classList.replace("landscape", "portrait");
            const portrait = document.querySelector('input[name="orientation"][value="portrait"]');
            const landscape = document.querySelector('input[name="orientation"][value="landscape"]');
            if (portrait) portrait.checked = true;
            if (landscape) landscape.checked = false;
          }
          document.querySelectorAll("[data-export]").forEach(button => { button.disabled = false; });
        }

        if (pathname === "/admin-members.html") {
          show("#adminArea, #memberArea");
          markup("#memberArea", `<div class="table-wrap"><table><thead><tr><th>회원번호</th><th>이름</th><th>회원유형</th><th>지역</th><th>상태</th><th>관리</th></tr></thead><tbody><tr><td>NCC-C-000016</td><td>김소비</td><td>일반회원</td><td>서울특별시</td><td>활성</td><td><button type="button">상세 관리</button></td></tr></tbody></table></div>`);
          if (variant === "member-modal") show("#memberModal");
          if (variant === "bulk-modal") show("#bulkImportModal");
        }

        if (pathname === "/admin-accounts.html") {
          show("#adminAccountArea");
          markup("#requestList", `<article class="account-item"><div><strong>회원탈퇴 요청 검증</strong><p>NCC-C-000016 · 검토 대기</p></div><button class="role-button" type="button">상세 확인</button></article>`);
          if (["recovery", "restriction", "log"].includes(variant)) {
            hide("#requestPanel, #recoveryPanel, #restrictionPanel, #logPanel");
            show(`#${variant}Panel`);
          }
        }

        if (pathname === "/admin-operations.html") {
          show("#adminOperationArea");
          markup("#adminOperationList", `<article class="operation-item"><div><strong>센터 운영 제안 검증</strong><p>서울특별시 · 확인 중</p></div><button class="role-button" type="button">상태 관리</button></article>`);
        }

        if (pathname === "/admin-roles.html") {
          show("#adminRoleArea");
          markup("#roleMemberList", `<article class="role-editor"><div class="role-person"><b>김소비</b><small>NCC-C-000016 · member@example.com · 활성</small></div><label>회원 역할<select aria-label="회원 역할"><option>센터장</option></select></label><label>센터명 / 업체명<input aria-label="센터명 또는 업체명" value="서울중앙소비자센터"></label><label>센터코드 / 파트너ID<input aria-label="센터코드 또는 파트너 ID" value="NCC-SEOUL-CENTER"></label><button class="role-button" type="button">권한 저장</button></article>`);
        }

        if (pathname === "/benefit-detail.html") {
          show("#reviewForm");
          hide("#memberSideAction");
          document.querySelectorAll("#applicationForm input, #applicationForm textarea").forEach(input => {
            if (!input.value && input.type !== "checkbox") input.value = input.type === "tel" ? "010-0000-0000" : "회원 자동입력";
          });
        }

        if (pathname === "/groupbuy-detail.html") {
          show("#productDetail, #savedAddressField, #saveAddressField, #reviewForm");
          text("#productBadge", "모집 중");
          text("#productTitle", "NCC 공동구매 모바일 검증 상품");
          text("#productDescription", "실제 주문이나 결제를 만들지 않는 합성 렌더링 항목입니다.");
          text("#productPrice", "10,000원");
          text("#regularPrice", "12,000원");
          text("#productPeriod", "2026. 8. 30. ~ 2026. 9. 6.");
          text("#productTarget", "20명");
          text("#productShipping", "모집 확정 후 안내");
          text("#productSupplier", "NCC 협력 파트너");
          const image = document.querySelector("#productImage");
          if (image) image.src = "images/NCC_consumer.jpg";
        }

        if (pathname === "/order-detail.html") {
          show("#orderDetail, #detailPayLink");
          text("#detailProductTitle", "NCC 공동구매 모바일 검증 상품");
          text("#detailReceipt", "접수번호 NCC-AUDIT-0001");
          text("#detailStatus", "주문 확정");
          text("#detailDescription", "운영 데이터를 변경하지 않는 주문 상세 표시입니다.");
          text("#detailOption", "기본 구성");
          [["#detailQuantity", "1개"], ["#detailUnitPrice", "10,000원"], ["#detailTotalPrice", "10,000원"], ["#detailCreatedAt", "2026. 8. 30."], ["#detailAddress", "서울특별시 중구"], ["#detailPayment", "테스트 결제 대기"], ["#detailRecruitment", "모집 확정"], ["#detailOrderStatus", "주문 확정"], ["#detailDelivery", "배송 준비"], ["#detailAdminMemo", "안전한 검증용 표시"], ["#detailEditable", "관리자 확인 전"]].forEach(([selector, next]) => text(selector, next));
          const image = document.querySelector("#detailImage");
          if (image) {
            image.src = "images/NCC_consumer.jpg";
            image.alt = "NCC 공동구매 모바일 검증 상품";
          }
        }

        if (pathname === "/payment-checkout.html") {
          show("#checkoutContent");
          text("#checkoutTitle", "NCC 공동구매 모바일 검증 상품");
          text("#checkoutAmount", "10,000원");
          const button = document.querySelector("#payButton");
          if (button) button.disabled = false;
        }

        if (pathname === "/payment-result.html") {
          show("#resultContent, #resultDetails, #receiptLink");
          text("#resultBadge", "테스트 결제 완료");
          text("#resultTitle", "결제 확인이 완료되었습니다");
          text("#resultMessage", "실제 금전 이동 없이 결과 화면만 검증합니다.");
          text("#resultReceipt", "NCC-AUDIT-0001");
          text("#resultAmount", "10,000원");
          text("#resultStatus", "테스트 완료");
        }

        if (pathname === "/certificate-verify.html") {
          show("#verifyResult");
          text("#resultType", "NCC 회원번호");
          text("#resultNumber", "NCC-C-000016");
          text("#resultName", "김소비");
          text("#resultStatus", "정상");
          text("#resultDate", "2026. 8. 30.");
          text("#resultValidity", "유효");
          text("#resultIssuer", "전국소비자클럽 NCC");
        }

        if (pathname === "/password-reset.html") {
          show("#resetForm");
          text("#resetGuide", "새 비밀번호를 입력해 주세요.");
        }

        return { state: "protected", applied: revealed.length > 0, pathname, variant, revealed: [...new Set(revealed)] };
      });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
    } catch (error) {
      pageErrors.push(`protected state preparation: ${String(error.message || error).slice(0, 400)}`);
      statePreparation = { state: "protected", applied: false, revealed: [] };
    }
  }

  if (response) {
    let redirectedRequest = response.request().redirectedFrom();
    while (redirectedRequest) {
      const redirectResponse = await redirectedRequest.response();
      redirects.unshift({
        url: redirectedRequest.url(),
        status: redirectResponse?.status() || 0,
      });
      redirectedRequest = redirectedRequest.redirectedFrom();
    }
  }

  const inspection = navigationError ? null : await page.evaluate(({ expectedFont, allowedWeights }) => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const nodes = [...document.querySelectorAll("body, p, li, label, h1, h2, h3, h4, button, input, select, textarea, a, span, small, dt, dd")]
      .filter(visible);
    const typography = nodes.slice(0, 1400).map(element => {
      const style = getComputedStyle(element);
      return {
        selector: `${element.tagName.toLowerCase()}#${element.id || ""}.${typeof element.className === "string" ? element.className : ""}`.slice(0, 180),
        tag: element.tagName.toLowerCase(),
        family: style.fontFamily,
        weight: style.fontWeight,
        size: style.fontSize,
        type: element.getAttribute("type") || "",
        letterSpacing: style.letterSpacing,
        text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80),
        previewArtifact: Boolean(element.closest(".member-card, .business-card")),
      };
    });
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const imagesMissingAlt = [...document.querySelectorAll("img")]
      .filter(image => !image.hasAttribute("alt"))
      .map(image => image.currentSrc || image.src);
    const brokenFirstPartyImages = [...document.querySelectorAll("img")]
      .filter(visible)
      .filter(image => {
        const source = image.currentSrc || image.src;
        if (!source) return true;
        try {
          return new URL(source, location.href).origin === location.origin && image.complete && image.naturalWidth === 0;
        } catch {
          return true;
        }
      })
      .map(image => image.currentSrc || image.src || image.alt || "image without source");
    const viewportWidth = window.innerWidth;
    const unlabeledControls = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea")]
      .filter(visible)
      .filter(element => {
        if (element.tagName === "BUTTON" && (element.textContent || "").trim()) return false;
        if (element.getAttribute("aria-label") || element.getAttribute("aria-labelledby")) return false;
        if (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) return false;
        return !element.closest("label");
      })
      .map(element => `${element.tagName.toLowerCase()}#${element.id || ""}.${element.className || ""}`.slice(0, 180));
    const smallControls = viewportWidth <= 768
      ? [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, a[href]")]
        .filter(visible)
        .filter(element => !element.matches('input[type="checkbox"], input[type="radio"]'))
        .filter(element => {
          if (element.tagName !== "A") return true;
          const style = getComputedStyle(element);
          return style.display !== "inline" || !element.closest("p, li, dd");
        })
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { selector: `${element.tagName.toLowerCase()}#${element.id || ""}.${element.className || ""}`.slice(0, 180), width: Math.round(rect.width), height: Math.round(rect.height) };
        })
        .filter(item => item.width < 44 || item.height < 44)
      : [];
    const documentClientWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const overflowElements = [...document.querySelectorAll("body *")]
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}#${element.id || ""}.${typeof element.className === "string" ? element.className : ""}`.slice(0, 180),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter(item => item.left < -2 || item.right > viewportWidth + 2)
      .slice(0, 30);
    const bodyStyle = getComputedStyle(document.body);
    const viewportContent = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
    const zoomBlocked = /user-scalable\s*=\s*no|maximum-scale\s*=\s*(?:0|1(?:\.0*)?)(?:\s|,|$)/i.test(viewportContent);
    const mobileFormText = viewportWidth <= 430
      ? typography.filter(item => ["input", "select", "textarea", "button"].includes(item.tag))
        .filter(item => !["checkbox", "radio", "range", "color", "file", "hidden"].includes(item.type))
        .filter(item => parseFloat(item.size) < 16)
      : [];
    const unreadablySmallText = viewportWidth <= 430
      ? typography.filter(item => !item.previewArtifact && item.text && parseFloat(item.size) < 12)
      : [];
    const clippedText = viewportWidth <= 768
      ? [...document.querySelectorAll("h1, h2, h3, h4, button, label, a")]
        .filter(visible)
        .filter(element => !element.closest(".member-card, .business-card"))
        .filter(element => {
          const style = getComputedStyle(element);
          const clips = ["hidden", "clip"].includes(style.overflow)
            || ["hidden", "clip"].includes(style.overflowX)
            || ["hidden", "clip"].includes(style.overflowY);
          return clips && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
        })
        .map(element => `${element.tagName.toLowerCase()}#${element.id || ""}.${typeof element.className === "string" ? element.className : ""}`.slice(0, 180))
      : [];
    const highWeights = typography.filter(item => !allowedWeights.includes(item.weight));
    const strongNegativeSpacing = typography.filter(item => {
      const spacing = parseFloat(item.letterSpacing);
      const size = parseFloat(item.size);
      return Number.isFinite(spacing) && Number.isFinite(size) && size > 0 && spacing / size < -0.03;
    });
    const parseColor = value => {
      const match = String(value).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const blend = (foreground, background) => {
      const alpha = foreground[3];
      return [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        1,
      ];
    };
    const luminance = color => {
      const channels = color.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const backgroundFor = element => {
      const layers = [];
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        const color = parseColor(style.backgroundColor);
        if (style.backgroundImage !== "none") {
          if (!color || color[3] < 1) return null;
        }
        if (color && color[3] > 0) {
          layers.push(color);
          if (color[3] === 1) break;
        }
      }
      let resolved = [255, 255, 255, 1];
      for (const layer of layers.reverse()) resolved = blend(layer, resolved);
      return resolved;
    };
    const contrastIssues = nodes
      .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
      .filter(element => !element.closest(".cover, .back"))
      .map(element => {
        const style = getComputedStyle(element);
        const foreground = parseColor(style.color);
        const background = backgroundFor(element);
        if (!foreground || !background) return null;
        const renderedForeground = blend(foreground, background);
        const light = Math.max(luminance(renderedForeground), luminance(background));
        const dark = Math.min(luminance(renderedForeground), luminance(background));
        const ratio = (light + .05) / (dark + .05);
        const size = parseFloat(style.fontSize);
        const weight = Number(style.fontWeight) || 400;
        const largeText = size >= 24 || (size >= 18.66 && weight >= 600);
        const required = largeText ? 3 : 4.5;
        return ratio + .01 < required ? {
          selector: `${element.tagName.toLowerCase()}#${element.id || ""}.${typeof element.className === "string" ? element.className : ""}`.slice(0, 180),
          text: [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(" ").trim().slice(0, 80),
          ratio: Number(ratio.toFixed(2)),
          required,
          color: style.color,
          background: `rgb(${background.slice(0, 3).map(value => Math.round(value)).join(", ")})`,
        } : null;
      })
      .filter(Boolean);
    const loadedFonts = [...document.fonts].map(font => ({ family: font.family, weight: font.weight, status: font.status }));
    const activeMagazinePage = document.querySelector(".mag-page.visible");
    const magazinePage = activeMagazinePage ? {
      page: activeMagazinePage.getAttribute("data-page-number") || "",
      clientHeight: activeMagazinePage.clientHeight,
      scrollHeight: activeMagazinePage.scrollHeight,
      clipped: activeMagazinePage.scrollHeight > activeMagazinePage.clientHeight + 2,
    } : null;
    return {
      title: document.title,
      lang: document.documentElement.lang,
      viewportWidth,
      documentClientWidth,
      scrollWidth,
      horizontalOverflow: Math.max(0, scrollWidth - viewportWidth),
      overflowElements,
      bodyFont: bodyStyle.fontFamily,
      bodyWeight: bodyStyle.fontWeight,
      bodyFontSize: bodyStyle.fontSize,
      viewportContent,
      zoomBlocked,
      hasMain: Boolean(document.querySelector("main")),
      textLength: (document.body.innerText || "").trim().length,
      expectedFontReady: loadedFonts.some(font => font.family.replace(/["']/g, "") === expectedFont && font.status === "loaded"),
      loadedFonts: loadedFonts.filter((font, index, all) => all.findIndex(item => item.family === font.family && item.weight === font.weight && item.status === font.status) === index),
      magazinePage,
      usedFamilies: [...new Set(typography.map(item => item.family))],
      usedWeights: [...new Set(typography.map(item => item.weight))],
      highWeights: highWeights.slice(0, 30),
      strongNegativeSpacing: strongNegativeSpacing.slice(0, 30),
      contrastIssues: contrastIssues.slice(0, 30),
      duplicateIds,
      imagesMissingAlt,
      brokenFirstPartyImages: brokenFirstPartyImages.slice(0, 30),
      unlabeledControls: unlabeledControls.slice(0, 30),
      smallControls: smallControls.slice(0, 30),
      mobileFormText: mobileFormText.slice(0, 30),
      unreadablySmallText: unreadablySmallText.slice(0, 30),
      clippedText: clippedText.slice(0, 30),
    };
  }, { expectedFont, allowedWeights: [...allowedWeights] });

  const shouldScreenshot = screenshotMode === "all" || (screenshotMode === "core" && coreRoutes.includes(route));
  if (!navigationError && shouldScreenshot) {
    await page.screenshot({
      path: path.join(outputDir, "screenshots", `${fileKey(route)}-${viewport.name}-${phase}-${auditState}.jpg`),
      fullPage: true,
      type: "jpeg",
      quality: 78,
    });
  }

  results.push({
    route,
    auditState,
    statePreparation,
    routePath: new URL(route, "https://ncc.local").pathname,
    viewport: viewport.name,
    width: viewport.width,
    status: response?.status() || 0,
    finalUrl: page.url(),
    headers: response ? {
      contentType: response.headers()["content-type"] || "",
      cacheControl: response.headers()["cache-control"] || "",
      xFrameOptions: response.headers()["x-frame-options"] || "",
      xContentTypeOptions: response.headers()["x-content-type-options"] || "",
      referrerPolicy: response.headers()["referrer-policy"] || "",
      permissionsPolicy: response.headers()["permissions-policy"] || "",
      xRobotsTag: response.headers()["x-robots-tag"] || "",
    } : {},
    navigationError,
    consoleErrors: unique(consoleErrors),
    pageErrors: unique(pageErrors),
    failedRequests: unique(failedRequests),
    badResponses: unique(badResponses),
    redirects,
    inspection,
  });
  await context.close();
  }));
}

results.sort((left, right) => {
  const routeOrder = routes.indexOf(left.route) - routes.indexOf(right.route);
  if (routeOrder !== 0) return routeOrder;
  return viewports.findIndex(item => item.name === left.viewport)
    - viewports.findIndex(item => item.name === right.viewport);
});

await browser.close();
if (localServer) await new Promise((resolve, reject) => localServer.close(error => error ? reject(error) : resolve()));

const failures = results.flatMap(result => {
  const issues = [];
  const ignoreExternalFailures = process.env.NCC_AUDIT_IGNORE_EXTERNAL_FAILURES === "true";
  const expectedStatus = result.routePath === notFoundAuditRoute ? 404 : 200;
  if (result.status !== expectedStatus) issues.push(`HTTP ${result.status || "navigation failure"}; expected ${expectedStatus}`);
  if (result.navigationError) issues.push(`navigation: ${result.navigationError}`);
  if (result.auditState === "protected" && !result.statePreparation?.applied) issues.push("protected state was not rendered");
  if (result.pageErrors.length) issues.push(`page errors: ${result.pageErrors.join(" | ")}`);
  const actionableConsoleErrors = result.consoleErrors.filter(item => !(
    result.routePath === notFoundAuditRoute
    && item.includes(notFoundAuditRoute)
    && /404|Not Found/i.test(item)
  ));
  if (!ignoreExternalFailures && actionableConsoleErrors.length) issues.push(`console errors: ${actionableConsoleErrors.join(" | ")}`);
  const actionableFailedRequests = result.failedRequests.filter(item => !/net::ERR_ABORTED$/i.test(item));
  if (!ignoreExternalFailures && actionableFailedRequests.length) issues.push(`failed requests: ${actionableFailedRequests.join(" | ")}`);
  if (!ignoreExternalFailures && result.badResponses.length) issues.push(`bad responses: ${result.badResponses.join(" | ")}`);
  if (result.inspection?.horizontalOverflow > 2) issues.push(`horizontal overflow ${result.inspection.horizontalOverflow}px`);
  if (!result.inspection?.expectedFontReady) issues.push(`${expectedFont} not ready`);
  if (result.inspection?.highWeights.length) issues.push(`unsupported weights: ${unique(result.inspection.highWeights.map(item => item.weight)).join(",")}`);
  if (result.inspection?.strongNegativeSpacing.length) issues.push("excessive negative letter spacing");
  if (result.inspection?.contrastIssues.length) issues.push("text contrast below WCAG AA");
  if (result.inspection?.duplicateIds.length) issues.push(`duplicate ids: ${result.inspection.duplicateIds.join(",")}`);
  if (result.inspection?.imagesMissingAlt.length) issues.push("images missing alt");
  if (result.inspection?.brokenFirstPartyImages.length) issues.push("broken first-party images");
  if (result.inspection?.unlabeledControls.length) issues.push("unlabeled controls");
  if (result.inspection?.smallControls.length) issues.push("controls below 44px");
  if (result.inspection?.mobileFormText.length) issues.push("mobile form text below 16px");
  if (result.inspection?.unreadablySmallText.length) issues.push("mobile text below 12px");
  if (result.inspection?.clippedText.length) issues.push("clipped mobile text");
  if (result.inspection?.magazinePage?.clipped) issues.push(`magazine page ${result.inspection.magazinePage.page} content is clipped`);
  if (!result.inspection?.viewportContent) issues.push("missing viewport meta");
  if (result.inspection?.zoomBlocked) issues.push("mobile zoom is blocked");
  if (!result.inspection?.hasMain) issues.push("missing main landmark");
  if ((result.inspection?.textLength || 0) < 10) issues.push("page content is empty or incomplete");
  const redirectRule = redirectRuleBySource.get(result.routePath);
  if (redirectRule) {
    const finalPath = new URL(result.finalUrl).pathname;
    const canonicalTarget = redirectRule.to.replace(/\.html$/, "") || "/";
    if (finalPath !== redirectRule.to && finalPath !== canonicalTarget) {
      issues.push(`redirect target ${finalPath}; expected ${redirectRule.to} or ${canonicalTarget}`);
    }
    if (!result.redirects.some(item => item.status === redirectRule.status)) {
      issues.push(`redirect status missing; expected ${redirectRule.status}`);
    }
  }
  return issues.length ? [{ route: result.route, viewport: result.viewport, issues }] : [];
});

const report = {
  referenceCode: "REF-NCC-MOBILE-FULL-AUDIT-FIX-20260830-01",
  phase,
  auditState,
  baseUrl,
  generatedAt: new Date().toISOString(),
  expectedFont,
  auditedRoutes,
  auditedViewports: viewports,
  testedRouteViewportPairs: results.length,
  failures,
  results,
};

await writeFile(path.join(outputDir, `ncc-public-audit-${phase}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  referenceCode: report.referenceCode,
  phase,
  testedRouteViewportPairs: results.length,
  failedPairs: failures.length,
  failureSummary: failures.slice(0, 30),
}, null, 2));

if (process.env.NCC_AUDIT_ENFORCE === "true" && failures.length) process.exitCode = 1;
