import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../admin-members.html", import.meta.url), "utf8");

test("member administration exposes the complete signup profile in a dedicated tab", () => {
  assert.match(source, /data-tab="profile"/);
  assert.match(source, /id="tab-profile"/);
  for (const id of [
    "editPostalCode", "editAddress", "editAddressDetail", "editRecipientName",
    "editJob", "editMaritalStatus", "editFamilyComposition", "editPreferredProducts", "editPreferredServices", "editPreferredPriceRange",
    "editPetType", "editHasVehicle", "editHousingType", "editHealthInterests", "editTravelInterests", "editLifeServiceInterests",
    "editFrequentPurchases", "editOnlineMalls", "editMonthlySpendRange", "editPurchaseMethod", "editExperienceInterests", "editReviewAvailable"
  ]) assert.match(source, new RegExp(`id="${id}"`));
});

test("member administration reads and writes the existing memberProfiles document safely", () => {
  assert.match(source, /getDoc\(doc\(db,"memberProfiles",member\.id\)\)/);
  assert.match(source, /writeBatch\(db\)/);
  assert.match(source, /selectedMemberProfileState === "error"/);
  assert.match(source, /agreeProfileUse:previousProfile\?\.special\?\.agreeProfileUse === true/);
  assert.doesNotMatch(source, /collection\(db,"memberSignupProfiles"\)/);
});

test("profile consent remains visible as a read-only agreement", () => {
  assert.match(source, /id="viewAgreeProfileUse"/);
  assert.match(source, /맞춤 혜택 프로필 활용/);
});
