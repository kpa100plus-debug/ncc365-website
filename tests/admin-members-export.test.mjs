import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../admin-members.html", import.meta.url), "utf8");

test("member administration exports only the current filtered result set", () => {
  assert.match(source, /id="memberExportCsvButton"/);
  assert.match(source, /id="memberExportExcelButton"/);
  assert.match(source, /currentFilteredMembers/);
  assert.match(source, /downloadFilteredMembers\("csv"\)/);
  assert.match(source, /downloadFilteredMembers\("excel"\)/);
});

test("export records access metadata before creating the file without logging member values", () => {
  assert.match(source, /collection\(db,"memberDataExportLogs"\)/);
  assert.match(source, /exportedCount:members\.length/);
  assert.match(source, /filterSummary:exportFilterSummary\(\)/);
  assert.match(source, /hasKeyword:Boolean\(memberSearch\.value\.trim\(\)\)/);
  assert.doesNotMatch(source, /keyword:memberSearch\.value/);
});

test("CSV and Excel exports neutralize formula-like cells", () => {
  assert.match(source, /\^\[=\+\\-@\]/);
  assert.match(source, /application\/vnd\.ms-excel/);
  assert.match(source, /NCC_회원목록_/);
});
