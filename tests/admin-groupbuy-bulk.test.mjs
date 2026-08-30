import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const html=await readFile(new URL("../admin-groupbuy.html",import.meta.url),"utf8");
const js=await readFile(new URL("../js/admin-groupbuy.js",import.meta.url),"utf8");
test("groupbuy administrator exposes safe bulk order controls",()=>{for(const id of ["selectVisibleOrders","applyBulkButton","downloadSelectedButton","downloadAllButton","importTrackingButton","shareTrackingButton"])assert.match(html,new RegExp(`id="${id}"`));assert.match(js,/writeBatch/);assert.match(js,/start\+=400/)});
test("tracking CSV matches exact receipts and validates required fields",()=>{assert.match(js,/item\.receipt===receipt/);assert.match(js,/접수번호, 택배사, 운송장번호 열/);assert.match(js,/trackingNumber\.length<5/);assert.match(js,/status:status\|\|"shipping"/)});
test("bulk export and sharing are available without leaking credentials",()=>{assert.match(js,/NCC_공동구매_/);assert.match(js,/navigator\.share/);assert.match(js,/navigator\.clipboard\.writeText/);assert.doesNotMatch(js,/apiKey\s*[:=]\s*["'][^"']+["']/)});
