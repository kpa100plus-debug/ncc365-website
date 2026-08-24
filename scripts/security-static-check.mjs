import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const findings = [];
const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,})/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Stripe live secret", /(?:sk|rk)_live_[0-9A-Za-z]{16,}/],
  ["OpenAI secret", /sk-[A-Za-z0-9_-]{20,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Google OAuth client secret", /GOCSPX-[A-Za-z0-9_-]{20,}/]
];

for (const file of trackedFiles) {
  if (file === "package-lock.json") continue;
  let content;
  try {
    content = readFileSync(file);
  } catch {
    continue;
  }
  if (content.length > 2_000_000 || content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push(`${label}: ${file}`);
  }
  if (/(^|\/)\.env(?:\.|$)/.test(file)) findings.push(`tracked environment file: ${file}`);
}

function requireText(file, expected) {
  const content = readFileSync(file, "utf8");
  for (const value of expected) {
    if (!content.includes(value)) findings.push(`missing required control in ${file}: ${value}`);
  }
}

requireText("firestore.rules", [
  "rules_version = '2';",
  "match /{document=**}",
  "allow read, write: if false;"
]);
requireText("firestore.lockdown.rules", [
  "match /{document=**}",
  "allow read, write: if false;"
]);
requireText("_headers", [
  "Strict-Transport-Security:",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Referrer-Policy:",
  "Permissions-Policy:",
  "Cache-Control: no-store",
  "X-Robots-Tag: noindex"
]);
requireText(".github/workflows/firebase-rules.yml", [
  "workload_identity_provider:",
  "service_account:",
  "id-token: write"
]);

if (findings.length) {
  console.error("NCC security static check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`NCC security static check passed (${trackedFiles.length} tracked files checked).`);
