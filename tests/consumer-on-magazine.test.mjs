import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../consumer-on.html',import.meta.url),'utf8');
const script=fs.readFileSync(new URL('../js/consumer-on.js',import.meta.url),'utf8');
const issue=JSON.parse(fs.readFileSync(new URL('../data/consumer-on/issues.json',import.meta.url),'utf8'));

test('first Consumer ON issue contains twelve independently addressable pages',()=>{
  assert.equal((html.match(/class="mag-page/g)||[]).length,12);
  for(let page=1;page<=12;page+=1)assert.match(html,new RegExp(`id="page-${page}"`));
  assert.equal(issue.issues[0].pages.length,12);
  assert.equal(issue.issues[0].status,'published');
});

test('reader exposes navigation, accessibility, export, print and sharing controls',()=>{
  for(const control of ['data-first','data-prev','data-next','data-last','data-zoom-in','data-zoom-out','data-fullscreen','data-share-issue','data-copy-page','data-save-page','data-save-jpg','data-print'])assert.match(html,new RegExp(control));
  assert.match(script,/ArrowRight/);
  assert.match(script,/touchstart/);
  assert.match(script,/localStorage/);
  assert.match(script,/html2canvas/);
  assert.match(script,/navigator\.share/);
  assert.match(script,/window\.print/);
});

test('magazine does not invent advertisers or expose member data',()=>{
  assert.doesNotMatch(html,/전화번호|이메일 주소|상세주소|생년월일|테스트 예시|샘플입니다/);
  assert.match(html,/계약되지 않은/);
  assert.match(html,/© 2026 ISEA GROUP\. All Rights Reserved\./);
});
