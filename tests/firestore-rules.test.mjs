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

async function seedMember(id, data = {}) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "members", id), {
      authUid: id,
      email: `${id}@example.com`,
      emailVerified: true,
      status: "active",
      name: id,
      phone: "01012345678",
      phoneKey: "01012345678",
      memberNumber: "NCC-C-TEST",
      region: "서울특별시",
      ...data
    });
  });
}

const addressRecord = (memberId, overrides = {}) => ({
  memberId,
  label: "테스트 배송지",
  recipient: "테스트 회원",
  phone: "01012345678",
  postalCode: "04524",
  address: "서울특별시 중구 세종대로 110",
  addressDetail: "보안규칙 테스트",
  isDefault: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides
});

const groupBuyOrder = (memberId, email, overrides = {}) => ({
  productId: "product-security-test",
  productTitle: "공동구매 보안규칙 테스트",
  memberId,
  memberEmail: email,
  name: "테스트 회원",
  phone: "010-1234-5678",
  phoneKey: "01012345678",
  quantity: 1,
  region: "서울특별시",
  address: "04524 서울특별시 중구 세종대로 110",
  message: "",
  receipt: "NCC-G-260825-12345",
  totalPrice: 10000,
  paymentGuide: "",
  carrier: "",
  trackingNumber: "",
  adminMemo: "",
  status: "new",
  source: "website",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides
});

test("member can manage only their own saved delivery address", async () => {
  await seedMember("member-1");
  await seedMember("member-2");
  const ownerDb = testEnv.authenticatedContext("member-1", {
    email: "member-1@example.com",
    email_verified: true
  }).firestore();
  const otherDb = testEnv.authenticatedContext("member-2", {
    email: "member-2@example.com",
    email_verified: true
  }).firestore();
  const addressId = "address-security-test";

  await assertSucceeds(setDoc(doc(ownerDb, "memberAddresses", addressId), addressRecord("member-1")));
  await assertSucceeds(getDoc(doc(ownerDb, "memberAddresses", addressId)));
  await assertFails(getDoc(doc(otherDb, "memberAddresses", addressId)));
  await assertFails(updateDoc(doc(otherDb, "memberAddresses", addressId), {
    label: "타인 수정 시도",
    updatedAt: serverTimestamp()
  }));
  await assertFails(deleteDoc(doc(otherDb, "memberAddresses", addressId)));
  await assertSucceeds(deleteDoc(doc(ownerDb, "memberAddresses", addressId)));
});

test("anonymous legacy group-buy order shape is rejected", async () => {
  const publicDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(addDoc(collection(publicDb, "groupBuyOrders"), {
    productId: "legacy-product",
    productTitle: "구형 주문",
    name: "비로그인 사용자",
    phone: "01012345678",
    phoneKey: "01012345678",
    quantity: 1,
    region: "서울특별시",
    address: "서울특별시 중구",
    message: "",
    receipt: "NCC-G-260825-54321",
    totalPrice: 10000,
    status: "new",
    source: "website",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
});

test("active member can create a group-buy order but paused member cannot", async () => {
  await seedMember("active-member");
  await seedMember("paused-member", { status: "paused" });
  const activeDb = testEnv.authenticatedContext("active-member", {
    email: "active-member@example.com",
    email_verified: true
  }).firestore();
  const pausedDb = testEnv.authenticatedContext("paused-member", {
    email: "paused-member@example.com",
    email_verified: true
  }).firestore();

  await assertSucceeds(addDoc(
    collection(activeDb, "groupBuyOrders"),
    groupBuyOrder("active-member", "active-member@example.com")
  ));
  await assertFails(addDoc(
    collection(pausedDb, "groupBuyOrders"),
    groupBuyOrder("paused-member", "paused-member@example.com", {
      receipt: "NCC-G-260825-67890"
    })
  ));
});

test("admin alone can update group-buy payment and delivery progress", async () => {
  await seedMember("order-member");
  const memberDb = testEnv.authenticatedContext("order-member", {
    email: "order-member@example.com",
    email_verified: true
  }).firestore();
  const adminDb = testEnv.authenticatedContext("admin-1", adminClaims).firestore();
  const order = await assertSucceeds(addDoc(
    collection(memberDb, "groupBuyOrders"),
    groupBuyOrder("order-member", "order-member@example.com", {
      receipt: "NCC-G-260825-24680"
    })
  ));

  await assertFails(updateDoc(doc(memberDb, "groupBuyOrders", order.id), {
    status: "confirmed",
    paymentGuide: "회원의 무단 변경",
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(adminDb, "groupBuyOrders", order.id), {
    status: "shipping",
    paymentGuide: "관리자 결제 안내",
    carrier: "테스트택배",
    trackingNumber: "TEST-1234",
    adminMemo: "배송 시작",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(adminDb, "groupBuyOrders", order.id), {
    trackingNumber: "X".repeat(81),
    updatedAt: serverTimestamp()
  }));
});

test("members cannot delete expectation likes but the administrator can clean them up", async () => {
  const likeId = "comment-1_member-feedback";
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "expectationLikes", likeId), {
      commentId: "comment-1",
      userId: "member-feedback",
      createdAt: Timestamp.fromMillis(1_777_000_000_000)
    });
  });
  const memberDb = testEnv.authenticatedContext("member-feedback", {
    email: "member-feedback@example.com",
    email_verified: true
  }).firestore();
  const adminDb = testEnv.authenticatedContext("admin-1", adminClaims).firestore();
  await assertFails(deleteDoc(doc(memberDb, "expectationLikes", likeId)));
  await assertSucceeds(deleteDoc(doc(adminDb, "expectationLikes", likeId)));
});
