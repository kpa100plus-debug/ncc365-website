import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc
} from "firebase/firestore";

const projectId = "ncc-security-test";
const adminClaims = { email: "kpa100plus@gmail.com", email_verified: true };
let testEnv;

const certificate = (overrides = {}) => ({
  certificateNumber: "NCC-EC-2026-TEST-0001",
  certificateType: "excellent_company",
  title: "소비자선정 우수기업 인증서",
  recipientName: "보안규칙 테스트 기업",
  representativeName: "",
  category: "테스트",
  region: "서울특별시",
  evaluationGroup: "NCC 소비자평가단",
  issuedAt: "2026-08-24",
  validUntil: "",
  issuer: "전국소비자클럽 소비자선정위원회",
  imageUrl: "",
  status: "sample",
  public: true,
  createdAt: Timestamp.fromMillis(1_777_000_000_000),
  updatedAt: Timestamp.fromMillis(1_777_000_000_000),
  ...overrides
});

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile("firestore.rules", "utf8") }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

async function seedCertificate(number, data) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "certificates", number), data);
  });
}

test("public certificate supports exact-document lookup but blocks collection listing", async () => {
  const number = "NCC-EC-2026-TEST-0001";
  await seedCertificate(number, certificate());
  const publicDb = testEnv.unauthenticatedContext().firestore();

  const snapshot = await assertSucceeds(getDoc(doc(publicDb, "certificates", number)));
  assert.equal(snapshot.data().status, "sample");
  await assertFails(getDocs(collection(publicDb, "certificates")));
});

test("private certificate is not readable by the public", async () => {
  const number = "NCC-EC-2026-TEST-0002";
  await seedCertificate(number, certificate({ certificateNumber: number, public: false }));
  const publicDb = testEnv.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(publicDb, "certificates", number)));
});

test("non-admin users cannot create certificate records", async () => {
  const number = "NCC-EC-2026-TEST-0003";
  const memberDb = testEnv.authenticatedContext("member-1", {
    email: "member@example.com",
    email_verified: true
  }).firestore();

  await assertFails(setDoc(doc(memberDb, "certificates", number), {
    ...certificate({ certificateNumber: number }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test("admin can create a valid certificate but cannot delete it", async () => {
  const number = "NCC-EC-2026-TEST-0004";
  const adminDb = testEnv.authenticatedContext("admin-1", adminClaims).firestore();
  const reference = doc(adminDb, "certificates", number);

  await assertSucceeds(setDoc(reference, {
    ...certificate({ certificateNumber: number }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
  await assertFails(deleteDoc(reference));
});

test("certificate audit logs are append-only", async () => {
  const adminDb = testEnv.authenticatedContext("admin-1", adminClaims).firestore();
  const log = await assertSucceeds(addDoc(collection(adminDb, "certificateLogs"), {
    certificateNumber: "NCC-EC-2026-TEST-0005",
    eventType: "created",
    status: "sample",
    public: true,
    actorEmail: adminClaims.email,
    createdAt: serverTimestamp()
  }));

  await assertFails(updateDoc(log, { status: "active" }));
  await assertFails(deleteDoc(log));
});

test("unknown collections are denied by the default rule", async () => {
  const publicDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(publicDb, "unexpected", "record")));
  await assertFails(setDoc(doc(publicDb, "unexpected", "record"), { value: true }));
});
