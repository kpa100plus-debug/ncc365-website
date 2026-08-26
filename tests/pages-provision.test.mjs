import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProjectConfigured,
  buildDeploymentConfigPatch,
  readPublicRuntimeConfig,
} from "../.github/scripts/configure-ncc-payment-pages.mjs";

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
  });
  for (const environment of ["production", "preview"]) {
    const config = patch.deployment_configs[environment];
    assert.deepEqual(config.d1_databases.NCC_PAYMENTS, { id: "database-id" });
    assert.deepEqual(config.env_vars.PAYMENT_MODE, { type: "plain_text", value: "test" });
    assert.equal(config.env_vars.FIREBASE_PROJECT_ID.value, "ncc-member");
  }
});

test("rejects a Pages project whose payment binding was not applied", () => {
  assert.throws(
    () => assertProjectConfigured({ deployment_configs: {} }, "database-id"),
    /binding verification failed/,
  );
});
