import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const findings = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if ([".git", "node_modules", "artifacts"].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target.replace(/^\.\//, "")];
  });
}

const files = walk(".");
const htmlFiles = files.filter(file => file.endsWith(".html"));
const styleFiles = files.filter(file => file.endsWith(".css") || file.endsWith(".html"));

function localTarget(sourceFile, target) {
  const clean = target.split(/[?#]/)[0];
  if (!clean) return null;
  const relative = clean.startsWith("/") ? clean.slice(1) : path.join(path.dirname(sourceFile), clean);
  const normalized = path.normalize(relative);
  if (existsSync(normalized)) return normalized;
  if (!path.extname(normalized) && existsSync(`${normalized}.html`)) return `${normalized}.html`;
  if (statSafe(normalized)?.isDirectory() && existsSync(path.join(normalized, "index.html"))) return path.join(normalized, "index.html");
  return null;
}

function statSafe(file) {
  try { return statSync(file); } catch { return null; }
}

for (const file of htmlFiles) {
  const content = readFileSync(file, "utf8");
  if (!/<html[^>]+lang=["']ko["']/i.test(content)) findings.push(`${file}: missing lang=ko`);
  if (!/<meta[^>]+name=["']viewport["']/i.test(content)) findings.push(`${file}: missing viewport meta`);
  if (!/<title>[^<]+<\/title>/i.test(content)) findings.push(`${file}: missing non-empty title`);

  for (const match of content.matchAll(/<(a|link|script|img|source)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    const [, tag, target] = match;
    if (target.includes("${")) continue;
    if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target)) continue;
    if (target === "#") {
      if (!/id=["']certificateImageLink["']/.test(match[0])) findings.push(`${file}: dead ${tag} target href="#"`);
      continue;
    }
    if (target.startsWith("#")) {
      const id = target.slice(1);
      if (id && !new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(content)) {
        findings.push(`${file}: missing in-page target ${target}`);
      }
      continue;
    }
    if (!localTarget(file, target)) findings.push(`${file}: missing local ${tag} target ${target}`);
  }

  for (const image of content.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=["'][^"']*["']/i.test(image[0])) findings.push(`${file}: image missing alt`);
  }
}

for (const file of styleFiles) {
  if (file === "css/ncc-fonts.css") continue;
  const content = readFileSync(file, "utf8");
  if (/font-weight\s*:\s*(?:700|750|800|900)\b/i.test(content)) findings.push(`${file}: disallowed heavy or synthetic font weight`);
  if (/font-weight\s*:\s*(?:650|750|850)\b/i.test(content)) findings.push(`${file}: nonstandard font weight`);
  if (/letter-spacing\s*:\s*(?:-0\.0[3456]|-\.0(?:3|35|4|45|5|55|6))em/i.test(content)) findings.push(`${file}: excessive negative letter spacing`);
}

const fontCss = readFileSync("css/ncc-fonts.css", "utf8");
for (const required of [
  "Noto Sans KR Variable",
  "@fontsource-variable/noto-sans-kr@5.3.0",
  "font-display: swap",
  "unicode-range:",
  "font-synthesis: none",
]) {
  if (!fontCss.includes(required)) findings.push(`css/ncc-fonts.css: missing ${required}`);
}

for (const baseCss of ["css/platform.css", "css/readability.css", "css/style.css", "css/admin-applications.css"]) {
  if (!readFileSync(baseCss, "utf8").includes("ncc-fonts.css?v=20260830-1")) {
    findings.push(`${baseCss}: missing pinned NCC font import`);
  }
}

if (!readFileSync("js/platform-shell.js", "utf8").includes("© 2026 ISEA GROUP. All Rights Reserved.")) {
  findings.push("js/platform-shell.js: missing required footer rights notice");
}

const functionRoutes = JSON.parse(readFileSync("_routes.json", "utf8"));
for (const requiredRoute of ["/api/payments/*", "/api/account/*"]) {
  if (!functionRoutes.include?.includes(requiredRoute)) findings.push(`_routes.json: missing ${requiredRoute}`);
}

if (findings.length) {
  console.error("NCC site quality check failed:");
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`NCC site quality check passed (${htmlFiles.length} HTML pages and ${styleFiles.length} style-bearing files checked).`);
