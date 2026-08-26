import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const playwrightModule = process.env.NCC_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(playwrightModule);

let baseUrl = (process.env.NCC_BASE_URL || "https://ncc365.com").replace(/\/$/, "");
const outputDir = process.env.NCC_AUDIT_OUTPUT || "artifacts/public-audit";
const phase = process.env.NCC_AUDIT_PHASE || "audit";
const expectedFont = "Noto Sans KR Variable";
const allowedWeights = new Set(["400", "500", "600"]);

const routes = [
  "/", "/join.html", "/wallet.html", "/profile", "/benefits.html",
  "/benefit.html", "/benefit-detail.html", "/groupbuy.html", "/groupbuy-detail.html",
  "/centers.html", "/center.html", "/center-guide.html", "/center-dashboard.html",
  "/partner-center.html", "/partner.html", "/partner-dashboard.html",
  "/consumer-channel.html", "/consumer-on.html", "/consumer-tv.html",
  "/certificate-verify.html", "/admin.html", "/admin-members.html",
  "/admin-applications.html", "/admin-inquiries.html", "/admin-groupbuy.html",
  "/admin-feedback.html", "/admin-certificates.html", "/admin-operations.html",
  "/admin-roles.html", "/admin-accounts.html", "/admin-payments",
];

const coreRoutes = [
  "/", "/join.html", "/wallet.html", "/profile", "/benefits.html",
  "/groupbuy.html", "/consumer-channel.html", "/admin.html", "/admin-payments",
];

const viewports = [
  { name: "pc-1920", width: 1920, height: 1080 },
  { name: "pc-1440", width: 1440, height: 1000 },
  { name: "pc-1024", width: 1024, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-360", width: 360, height: 800 },
];

const requestedRoutes = (process.env.NCC_AUDIT_ROUTES || "").split(",").map(value => value.trim()).filter(Boolean);
const requestedWidths = (process.env.NCC_AUDIT_WIDTHS || "")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)
  .map(Number)
  .filter(Number.isFinite);
const auditedRoutes = requestedRoutes.length ? routes.filter(route => requestedRoutes.includes(route)) : routes;

const routeViewports = auditedRoutes.flatMap(route => {
  const selected = coreRoutes.includes(route)
    ? viewports
    : viewports.filter(viewport => [1440, 768, 360].includes(viewport.width));
  const filtered = requestedWidths.length ? selected.filter(viewport => requestedWidths.includes(viewport.width)) : selected;
  return filtered.map(viewport => ({ route, viewport }));
});
const auditConcurrency = Math.min(6, Math.max(1, Number(process.env.NCC_AUDIT_CONCURRENCY) || 4));

function fileKey(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\.html$/, "").replace(/[^a-z0-9-]+/gi, "-");
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
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
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
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500));
  });
  page.on("pageerror", error => pageErrors.push(String(error.message || error).slice(0, 500)));
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`.slice(0, 700));
  });
  page.on("response", response => {
    const url = response.url();
    if (response.status() >= 400 && (url.startsWith(baseUrl) || /fonts\.(googleapis|gstatic)\.com/.test(url))) {
      badResponses.push(`${response.status()} ${url}`.slice(0, 700));
    }
  });

  let response;
  let navigationError = "";
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

  const inspection = navigationError ? null : await page.evaluate(({ expectedFont, allowedWeights }) => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const nodes = [...document.querySelectorAll("body, p, li, label, h1, h2, h3, h4, button, input, select, textarea, a")]
      .filter(visible);
    const typography = nodes.slice(0, 700).map(element => {
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        family: style.fontFamily,
        weight: style.fontWeight,
        size: style.fontSize,
        letterSpacing: style.letterSpacing,
        text: (element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 80),
      };
    });
    const ids = [...document.querySelectorAll("[id]")].map(element => element.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const imagesMissingAlt = [...document.querySelectorAll("img")]
      .filter(image => !image.hasAttribute("alt"))
      .map(image => image.currentSrc || image.src);
    const unlabeledControls = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea")]
      .filter(visible)
      .filter(element => {
        if (element.tagName === "BUTTON" && (element.textContent || "").trim()) return false;
        if (element.getAttribute("aria-label") || element.getAttribute("aria-labelledby")) return false;
        if (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) return false;
        return !element.closest("label");
      })
      .map(element => `${element.tagName.toLowerCase()}#${element.id || ""}.${element.className || ""}`.slice(0, 180));
    const smallControls = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, .ncc-button, .join-link, .wallet-link")]
      .filter(visible)
      .filter(element => !element.matches('input[type="checkbox"], input[type="radio"]'))
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { selector: `${element.tagName.toLowerCase()}#${element.id || ""}.${element.className || ""}`.slice(0, 180), width: Math.round(rect.width), height: Math.round(rect.height) };
      })
      .filter(item => item.width < 44 || item.height < 44);
    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const highWeights = typography.filter(item => !allowedWeights.includes(item.weight));
    const strongNegativeSpacing = typography.filter(item => {
      const spacing = parseFloat(item.letterSpacing);
      const size = parseFloat(item.size);
      return Number.isFinite(spacing) && Number.isFinite(size) && size > 0 && spacing / size < -0.03;
    });
    const loadedFonts = [...document.fonts].map(font => ({ family: font.family, weight: font.weight, status: font.status }));
    return {
      title: document.title,
      lang: document.documentElement.lang,
      viewportWidth,
      scrollWidth,
      horizontalOverflow: Math.max(0, scrollWidth - viewportWidth),
      bodyFont: getComputedStyle(document.body).fontFamily,
      bodyWeight: getComputedStyle(document.body).fontWeight,
      expectedFontReady: loadedFonts.some(font => font.family.replace(/["']/g, "") === expectedFont && font.status === "loaded"),
      loadedFonts,
      usedFamilies: [...new Set(typography.map(item => item.family))],
      usedWeights: [...new Set(typography.map(item => item.weight))],
      highWeights: highWeights.slice(0, 30),
      strongNegativeSpacing: strongNegativeSpacing.slice(0, 30),
      duplicateIds,
      imagesMissingAlt,
      unlabeledControls: unlabeledControls.slice(0, 30),
      smallControls: smallControls.slice(0, 30),
    };
  }, { expectedFont, allowedWeights: [...allowedWeights] });

  if (!navigationError && coreRoutes.includes(route)) {
    await page.screenshot({
      path: path.join(outputDir, "screenshots", `${fileKey(route)}-${viewport.name}-${phase}.png`),
      fullPage: true,
    });
  }

  results.push({
    route,
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
  if (result.status !== 200) issues.push(`HTTP ${result.status || "navigation failure"}`);
  if (result.navigationError) issues.push(`navigation: ${result.navigationError}`);
  if (result.pageErrors.length) issues.push(`page errors: ${result.pageErrors.join(" | ")}`);
  if (!ignoreExternalFailures && result.consoleErrors.length) issues.push(`console errors: ${result.consoleErrors.join(" | ")}`);
  const actionableFailedRequests = result.failedRequests.filter(item => !/net::ERR_ABORTED$/i.test(item));
  if (!ignoreExternalFailures && actionableFailedRequests.length) issues.push(`failed requests: ${actionableFailedRequests.join(" | ")}`);
  if (!ignoreExternalFailures && result.badResponses.length) issues.push(`bad responses: ${result.badResponses.join(" | ")}`);
  if (result.inspection?.horizontalOverflow > 2) issues.push(`horizontal overflow ${result.inspection.horizontalOverflow}px`);
  if (!result.inspection?.expectedFontReady) issues.push(`${expectedFont} not ready`);
  if (result.inspection?.highWeights.length) issues.push(`unsupported weights: ${unique(result.inspection.highWeights.map(item => item.weight)).join(",")}`);
  if (result.inspection?.strongNegativeSpacing.length) issues.push("excessive negative letter spacing");
  if (result.inspection?.duplicateIds.length) issues.push(`duplicate ids: ${result.inspection.duplicateIds.join(",")}`);
  if (result.inspection?.imagesMissingAlt.length) issues.push("images missing alt");
  if (result.inspection?.unlabeledControls.length) issues.push("unlabeled controls");
  if (result.inspection?.smallControls.length) issues.push("controls below 44px");
  return issues.length ? [{ route: result.route, viewport: result.viewport, issues }] : [];
});

const report = {
  referenceCode: "REF-NCC-WEBSITE-PERFECT-AUDIT-14",
  phase,
  baseUrl,
  generatedAt: new Date().toISOString(),
  expectedFont,
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
