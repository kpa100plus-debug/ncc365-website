import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProjectConfigured,
  buildDeploymentConfigPatch,
  readPublicRuntimeConfig,
} from "../.github/scripts/configure-ncc-payment-pages.mjs";
import { assertKoreanResetConfig, koreanResetTemplate } from "../.github/scripts/configure-ncc-firebase-email.mjs";
import { buildTossActivationPatch, validateTossKeys } from "../.github/scripts/configure-ncc-toss-pages.mjs";

test("reads the existing public Firebase and administrator settings", () => {
  const config = readPublicRuntimeConfig(
    'export const firebaseConfig={apiKey:"AIzaExample_123",projectId:"ncc-member"};',
    'const ADMIN_EMAIL = "Admin@Example.com";',
  );
  assert.deepEqual(config, {
    firebaseApiKey: "AIzaExample_123",
    firebaseProjectId: "ncc-member",
    adminEmail: "admin@example.com",
  });
});

test("builds isolated production and preview payment configuration", () => {
  const patch = buildDeploymentConfigPatch("database-id", {
    firebaseApiKey: "AIzaExample_123",
    firebaseProjectId: "ncc-member",
    adminEmail: "admin@example.com",
  }, "Tester@example.com");
  for (const environment of ["production", "preview"]) {
    const config = patch.deployment_configs[environment];
    assert.deepEqual(config.d1_databases.NCC_PAYMENTS, { id: "database-id" });
    assert.deepEqual(config.env_vars.PAYMENT_MODE, { type: "plain_text", value: "test" });
    assert.deepEqual(config.env_vars.PAYMENT_PROVIDER, { type: "plain_text", value: "simulation" });
    assert.deepEqual(config.env_vars.TOSS_MODE, { type: "plain_text", value: "disabled" });
    assert.deepEqual(config.env_vars.PAYMENT_TESTER_EMAILS, { type: "secret_text", value: "tester@example.com" });
    assert.equal(config.env_vars.FIREBASE_PROJECT_ID.value, "ncc-member");
  }
});

test("rejects a Pages project whose payment binding was not applied", () => {
  assert.throws(
    () => assertProjectConfigured({ deployment_configs: {} }, "database-id"),
    /binding verification failed/,
  );
});

test("builds and validates the Korean NCC Firebase reset template", () => {
  const template = koreanResetTemplate({ senderLocalPart: "noreply" });
  assert.equal(template.subject, "NCC 회원 비밀번호 재설정 안내");
  assert.match(template.body, /%LINK%/);
  assert.match(template.body, /NCC_HEADER\.webp/);
  assert.doesNotThrow(() => assertKoreanResetConfig({
    notification: {
      defaultLocale: "ko",
      sendEmail: { callbackUri: "https://ncc365.com/password-reset.html", resetPasswordTemplate: template },
    },
  }));
});

test("Toss activation validates paired Payment Widget keys", () => {
  assert.deepEqual(validateTossKeys("test", "test_gck_abcdefgh", "test_gsk_abcdefgh"), {
    clientKey: "test_gck_abcdefgh",
    secretKey: "test_gsk_abcdefgh",
  });
  assert.throws(() => validateTossKeys("test", "live_gck_abcdefgh", "test_gsk_abcdefgh"));
  assert.throws(() => validateTossKeys("live", "live_gck_abcdefgh", "test_gsk_abcdefgh"));
});

test("test activation enables Toss only with a protected internal tester list", () => {
  assert.throws(() => buildTossActivationPatch("test", "test_gck_abcdefgh", "test_gsk_abcdefgh"));
  const patch = buildTossActivationPatch(
    "test",
    "test_gck_abcdefgh",
    "test_gsk_abcdefgh",
    "",
    "Tester@example.com",
  );
  for (const environment of ["production", "preview"]) {
    const vars = patch.deployment_configs[environment].env_vars;
    assert.equal(vars.PAYMENT_MODE.value, "test");
    assert.equal(vars.PAYMENT_PROVIDER.value, "toss");
    assert.equal(vars.TOSS_MODE.value, "test");
    assert.equal(vars.TOSS_LIVE_CONFIRMATION.value, "disabled");
    assert.equal(vars.TOSS_CLIENT_KEY.type, "secret_text");
    assert.equal(vars.TOSS_SECRET_KEY.type, "secret_text");
    assert.deepEqual(vars.PAYMENT_TESTER_EMAILS, { type: "secret_text", value: "tester@example.com" });
  }
});

test("live activation requires exact confirmation and keeps preview safely disabled", () => {
  assert.throws(() => buildTossActivationPatch("live", "live_gck_abcdefgh", "live_gsk_abcdefgh", "wrong"));
  const patch = buildTossActivationPatch(
    "live",
    "live_gck_abcdefgh",
    "live_gsk_abcdefgh",
    "NCC-TOSS-LIVE-CONFIRMED",
    "",
  );
  const production = patch.deployment_configs.production.env_vars;
  const preview = patch.deployment_configs.preview.env_vars;
  assert.equal(production.PAYMENT_MODE.value, "live");
  assert.equal(production.TOSS_MODE.value, "live");
  assert.equal(production.TOSS_LIVE_CONFIRMATION.value, "NCC-TOSS-LIVE-CONFIRMED");
  assert.equal(preview.PAYMENT_MODE.value, "test");
  assert.equal(preview.PAYMENT_PROVIDER.value, "simulation");
  assert.equal(preview.TOSS_MODE.value, "disabled");
});
