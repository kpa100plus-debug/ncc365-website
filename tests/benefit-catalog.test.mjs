import assert from "node:assert/strict";
import test from "node:test";
import { benefitCatalog, benefitMap } from "../js/benefit-catalog.js";

test("FIRST, PREMIUM and DAILY each expose nine distinct benefits", () => {
  assert.equal(benefitCatalog.length, 27);
  assert.equal(new Set(benefitCatalog.map(item => item.id)).size, 27);
  for (const tier of ["first", "premium", "daily"]) {
    assert.equal(benefitCatalog.filter(item => item.tier === tier).length, 9);
  }
});

test("every benefit has a complete detail record without test labels", () => {
  for (const item of benefitCatalog) {
    assert.equal(benefitMap[item.id], item);
    for (const field of ["title", "lead", "image", "area", "condition", "status"]) assert.ok(item[field]);
    assert.equal(/테스트|예시|샘플/.test(JSON.stringify(item)), false);
  }
});
