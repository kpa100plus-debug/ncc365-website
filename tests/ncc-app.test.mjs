import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appHtml = readFileSync("app.html", "utf8");
const appScript = readFileSync("js/ncc-app.js", "utf8");
const appCss = readFileSync("css/ncc-app.css", "utf8");
const manifest = JSON.parse(readFileSync("site.webmanifest", "utf8"));
const serviceWorker = readFileSync("sw.js", "utf8");

test("NCC app exposes all five core member destinations", () => {
  for (const tab of ["home", "benefits", "groupbuy", "notifications", "my"]) {
    assert.match(appHtml, new RegExp(`data-tab="${tab}"`));
    assert.match(appHtml, new RegExp(`data-panel="${tab}"`));
  }
  assert.match(appHtml, /NCC 월렛/);
  assert.match(appHtml, /공동구매/);
  assert.match(appHtml, /NCC 알림/);
});

test("NCC app is installable as the primary PWA entry point", () => {
  assert.equal(manifest.id, "/app");
  assert.match(manifest.start_url, /^\/app\.html/);
  assert.equal(manifest.display, "standalone");
  assert.match(appHtml, /apple-mobile-web-app-capable/);
  assert.match(appScript, /beforeinstallprompt/);
  assert.match(appScript, /serviceWorker\.register\("sw\.js"\)/);
});

test("NCC app reads existing benefit, order, and member notification data", () => {
  for (const collectionName of ["groupBuyProducts", "benefitApplications", "groupBuyOrders", "memberNotifications"]) {
    assert.match(appScript, new RegExp(`collection\\(db, "${collectionName}"\\)`));
  }
  assert.match(appScript, /onAuthStateChanged/);
  assert.match(appScript, /Notification\.requestPermission/);
});

test("NCC app includes compact device-safe layout rules", () => {
  assert.match(appCss, /safe-area-inset-bottom/);
  assert.match(appCss, /@media \(max-width:420px\)/);
  assert.match(appCss, /@media \(max-width:340px\)/);
  assert.match(appCss, /font-synthesis:none/);
  assert.doesNotMatch(appCss, /font-weight\s*:\s*(?:700|750|800|900)\b/);
});

test("service worker only falls back to the app shell for app navigation", () => {
  assert.match(serviceWorker, /\["\/app", "\/app\.html"\]\.includes\(url\.pathname\)/);
  assert.match(serviceWorker, /ncc-app-shell-20260831-1/);
});
