import{initializeApp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";import{getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";import{getFirestore,collection,getDocs,addDoc,deleteDoc,doc,updateDoc,serverTimestamp,writeBatch}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const config={apiKey:"AIzaSyBHL7qCPUwcp9Vp_1dYWfCk2qBvRgJ9mcM",authDomain:"ncc-member.firebaseapp.com",projectId:"ncc-member",storageBucket:"ncc-member.firebasestorage.app",messagingSenderId:"772423138834",appId:"1:772423138834:web:753b6d6dc6f394904822cb"},app=initializeApp(config),auth=getAuth(app),db=getFirestore(app),ADMIN="kpa100plus@gmail.com",$=s=>document.querySelector(s);let products=[],orders=[],selectedOrderIds=new Set();const orderLabels={new:"신규",checking:"확인중",confirmed:"주문확정",paid:"결제확인",shipping:"배송중",completed:"완료",cancelled:"취소"},productLabels={draft:"준비중",recruiting:"모집중",confirmed:"진행확정",closed:"마감"};
$("#loginButton").onclick=async()=>{try{$("#loginError").textContent="";await signInWithEmailAndPassword(auth,$("#adminEmail").value.trim(),$("#adminPassword").value)}catch{$("#loginError").textContent="로그인 정보를 확인해 주세요."}};$("#logoutButton").onclick=()=>signOut(auth);$("#refreshButton").onclick=load;$("#orderStatusFilter").onchange=renderOrders;$("#orderSearch").oninput=renderOrders;$("#newProductButton").onclick=()=>openForm();$("#cancelProductButton").onclick=()=>$("#productForm").hidden=true;
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));$("#productsPanel").hidden=b.dataset.tab!=="products";$("#ordersPanel").hidden=b.dataset.tab!=="orders"});
onAuthStateChanged(auth,async user=>{if(user?.email?.toLowerCase()===ADMIN){$("#loginArea").hidden=true;$("#adminArea").hidden=false;await load()}else{if(user)await signOut(auth);$("#loginArea").hidden=false;$("#adminArea").hidden=true}});
async function load(){try{const[ps,os]=await Promise.all([getDocs(collection(db,"groupBuyProducts")),getDocs(collection(db,"groupBuyOrders"))]);products=ps.docs.map(d=>({id:d.id,...d.data()})).sort(byDate);orders=os.docs.map(d=>({id:d.id,...d.data()})).sort(byDate);renderProducts();renderOrders();stats()}catch(e){console.error(e);$("#productList").innerHTML=$("#orderList").innerHTML='<div class="empty">데이터를 불러오지 못했습니다. Firestore 권한을 확인해 주세요.</div>'}}
const byDate=(a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0),money=v=>new Intl.NumberFormat("ko-KR").format(Number(v||0)),esc=v=>String(v||"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
function stats(){$("#productCount").textContent=products.length;$("#publishedCount").textContent=products.filter(p=>p.published).length;$("#orderCount").textContent=orders.length;$("#newOrderCount").textContent=orders.filter(o=>o.status==="new").length}
function renderProducts(){$("#productList").innerHTML=products.length?products.map(p=>`<article class="admin-product-card"><div><small>${esc(p.category)} · ${productLabels[p.status]||p.status} · ${p.published?"공개":"비공개"}</small><h2>${esc(p.title)}</h2><p>${money(p.price)}원 · 목표 ${money(p.minParticipants)}명 · ${esc(p.startDate||"")}~${esc(p.endDate||"")}</p></div><div class="admin-actions"><button data-edit="${p.id}">상품 수정</button><a href="groupbuy-detail.html?id=${encodeURIComponent(p.id)}" target="_blank">상세 미리보기</a></div></article>`).join(""):'<div class="empty">등록된 상품이 없습니다.</div>';document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openForm(products.find(p=>p.id===b.dataset.edit)))}
function openForm(p={}){const f=$("#productForm");f.reset();for(const [k,v]of Object.entries(p))if(f.elements[k]&&!["createdAt","updatedAt"].includes(k))f.elements[k].value=typeof v==="boolean"?String(v):v??"";f.elements.productId.value=p.id||"";f.hidden=false;f.scrollIntoView({behavior:"smooth",block:"start"})}
$("#productForm").onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button[type="submit"]'),d=Object.fromEntries(new FormData(f)),id=d.productId;delete d.productId;Object.assign(d,{price:Number(d.price),regularPrice:Number(d.regularPrice||0),minParticipants:Number(d.minParticipants),stock:Number(d.stock||0),published:d.published==="true",updatedAt:serverTimestamp()});b.disabled=true;try{if(id)await updateDoc(doc(db,"groupBuyProducts",id),d);else await addDoc(collection(db,"groupBuyProducts"),{...d,createdAt:serverTimestamp()});f.hidden=true;await load()}catch(error){console.error(error);$("#productMessage").textContent="상품을 저장하지 못했습니다."}finally{b.disabled=false}};
function isAutomationOrder(order){return String(order.message||"").includes("CI 자동검사")}
function visibleOrders(){const st=$("#orderStatusFilter").value,w=$("#orderSearch").value.trim().toLowerCase();return orders.filter(o=>(st==="all"||o.status===st)&&(!w||[o.productTitle,o.name,o.phone,o.receipt].some(v=>String(v||"").toLowerCase().includes(w)))}function renderOrders(){const rows=visibleOrders();selectedOrderIds=new Set([...selectedOrderIds].filter(id=>orders.some(order=>order.id===id)));$("#orderList").innerHTML=rows.length?rows.map(o=>`<article class="application-card"><label class="order-selector"><input type="checkbox" data-order-select="${o.id}" ${selectedOrderIds.has(o.id)?"checked":""}> 선택</label><div><p class="receipt">${esc(o.receipt)} · ${o.createdAt?.toDate?o.createdAt.toDate().toLocaleString("ko-KR"):""}</p><h2>${esc(o.productTitle)} <small>${o.quantity}개 · ${money(o.totalPrice)}원</small></h2><div class="meta"><b>${esc(o.name)}</b><span>${esc(o.phone)}</span><span>${esc(o.region)}</span></div><p class="message">${esc(o.address)}<br>${esc(o.message||"")}</p></div><div class="card-actions order-progress-editor"><label>처리상태<select id="order-${o.id}">${Object.entries(orderLabels).map(([v,l])=>`<option value="${v}" ${o.status===v?"selected":""}>${l}</option>`).join("")}</select></label><label>결제 안내<textarea id="payment-${o.id}" maxlength="500" rows="2" placeholder="입금계좌·결제링크·결제기한 등">${esc(o.paymentGuide||"")}</textarea></label><label>택배사<input id="carrier-${o.id}" maxlength="60" value="${esc(o.carrier||"")}" placeholder="예: CJ대한통운"></label><label>운송장번호<input id="tracking-${o.id}" maxlength="80" value="${esc(o.trackingNumber||"")}"></label><label>관리자 메모<textarea id="memo-${o.id}" maxlength="500" rows="2">${esc(o.adminMemo||"")}</textarea></label><button data-order-save="${o.id}">상태·안내 저장</button>${isAutomationOrder(o)&&o.status==="cancelled"?`<button class="danger" data-order-cleanup="${o.id}">자동검사 주문 삭제</button>`:""}</div></article>`).join(""):'<div class="empty">조건에 맞는 주문이 없습니다.</div>';document.querySelectorAll("[data-order-save]").forEach(b=>b.onclick=saveOrder);document.querySelectorAll("[data-order-cleanup]").forEach(b=>b.onclick=cleanupTestOrder);document.querySelectorAll("[data-order-select]").forEach(box=>box.onchange=()=>{box.checked?selectedOrderIds.add(box.dataset.orderSelect):selectedOrderIds.delete(box.dataset.orderSelect);updateSelectionUi()});updateSelectionUi()}
async function saveOrder(e){const b=e.currentTarget,id=b.dataset.orderSave,status=$(`#order-${id}`).value,paymentGuide=$(`#payment-${id}`).value.trim(),carrier=$(`#carrier-${id}`).value.trim(),trackingNumber=$(`#tracking-${id}`).value.trim(),adminMemo=$(`#memo-${id}`).value.trim();if(status==="confirmed"&&!paymentGuide){alert("주문확정 단계에는 회원에게 표시할 결제 안내를 입력해 주세요.");return}if(status==="shipping"&&(!carrier||!trackingNumber)){alert("배송중 단계에는 택배사와 운송장번호를 모두 입력해 주세요.");return}b.disabled=true;try{await updateDoc(doc(db,"groupBuyOrders",id),{status,paymentGuide,carrier,trackingNumber,adminMemo,updatedAt:serverTimestamp()});Object.assign(orders.find(o=>o.id===id),{status,paymentGuide,carrier,trackingNumber,adminMemo});renderOrders();stats()}catch(error){console.error(error);alert("상태와 안내를 저장하지 못했습니다.")}finally{b.disabled=false}}
async function cleanupTestOrder(e){const b=e.currentTarget,id=b.dataset.orderCleanup,order=orders.find(o=>o.id===id);if(!order||!isAutomationOrder(order)||order.status!=="cancelled"){alert("취소된 자동검사 주문만 삭제할 수 있습니다.");return}if(!confirm(`${order.receipt} 자동검사 주문을 삭제하시겠습니까?`))return;b.disabled=true;try{await deleteDoc(doc(db,"groupBuyOrders",id));orders=orders.filter(o=>o.id!==id);renderOrders();stats()}catch(error){console.error(error);alert("자동검사 주문을 삭제하지 못했습니다.")}finally{b.disabled=false}}

/* REF-NCC-GROUPBUY-BULK-OPERATIONS-20260830 */
function selectedOrders(){
  return orders.filter(order=>selectedOrderIds.has(order.id));
}
function updateSelectionUi(){
  const selected=selectedOrders();
  $("#selectedOrderCount").textContent=`${selected.length}건 선택`;
  const visible=visibleOrders();
  const toggle=$("#selectVisibleOrders");
  toggle.checked=visible.length>0&&visible.every(order=>selectedOrderIds.has(order.id));
  toggle.indeterminate=visible.some(order=>selectedOrderIds.has(order.id))&&!toggle.checked;
}
$("#selectVisibleOrders").onchange=event=>{
  for(const order of visibleOrders()){
    event.target.checked?selectedOrderIds.add(order.id):selectedOrderIds.delete(order.id);
  }
  renderOrders();
};
function bulkPatch(){
  const patch={};
  const status=$("#bulkStatus").value;
  const paymentGuide=$("#bulkPaymentGuide").value.trim();
  const carrier=$("#bulkCarrier").value.trim();
  if(status)patch.status=status;
  if(paymentGuide)patch.paymentGuide=paymentGuide;
  if(carrier)patch.carrier=carrier;
  return patch;
}
async function updateOrdersInChunks(items,patchFor){
  let succeeded=0;
  const failed=[];
  for(let start=0;start<items.length;start+=400){
    const group=items.slice(start,start+400);
    const batch=writeBatch(db);
    for(const item of group){
      batch.update(doc(db,"groupBuyOrders",item.id),{...patchFor(item),updatedAt:serverTimestamp()});
    }
    try{
      await batch.commit();
      succeeded+=group.length;
    }catch(error){
      console.error(error);
      failed.push(...group.map(item=>item.receipt||item.id));
    }
  }
  return{succeeded,failed};
}
$("#applyBulkButton").onclick=async()=>{
  const items=selectedOrders(),patch=bulkPatch(),message=$("#bulkMessage"),button=$("#applyBulkButton");
  if(!items.length){message.textContent="일괄 적용할 주문을 먼저 선택해 주세요.";return}
  if(!Object.keys(patch).length){message.textContent="변경할 처리상태, 택배사 또는 결제 안내를 입력해 주세요.";return}
  if(patch.status==="confirmed"&&!patch.paymentGuide&&!items.every(order=>order.paymentGuide)){
    message.textContent="주문확정에는 결제 안내가 필요합니다.";return
  }
  if(patch.status==="shipping"&&!patch.carrier&&!items.every(order=>order.carrier)){
    message.textContent="배송중 처리에는 택배사가 필요합니다.";return
  }
  if(!confirm(`선택한 ${items.length}건에 입력한 내용을 일괄 적용하시겠습니까?`))return;
  button.disabled=true;message.textContent="선택 주문을 처리하고 있습니다.";
  const result=await updateOrdersInChunks(items,()=>patch);
  if(result.succeeded){
    for(const item of items)if(!result.failed.includes(item.receipt||item.id))Object.assign(item,patch);
  }
  message.textContent=result.failed.length?`${result.succeeded}건 성공, ${result.failed.length}건 실패했습니다. 실패 접수번호: ${result.failed.join(", ")}`:`${result.succeeded}건을 정상 처리했습니다.`;
  button.disabled=false;renderOrders();stats();
};
const csvCell=value=>`"${String(value??"").replaceAll('"','""')}"`;
function orderCsv(items){
  const header=["접수번호","상품명","이름","연락처","지역","주소","수량","결제금액","처리상태","결제안내","택배사","운송장번호"];
  const rows=items.map(order=>[order.receipt,order.productTitle,order.name,order.phone,order.region,order.address,order.quantity,order.totalPrice,order.status,order.paymentGuide,order.carrier,order.trackingNumber]);
  return "\ufeff"+[header,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n");
}
function downloadCsv(items,label){
  if(!items.length){$("#bulkMessage").textContent="다운로드할 주문이 없습니다.";return}
  const blob=new Blob([orderCsv(items)],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`NCC_공동구매_${label}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  $("#bulkMessage").textContent=`${items.length}건 CSV 다운로드를 시작했습니다.`;
}
$("#downloadSelectedButton").onclick=()=>downloadCsv(selectedOrders(),"선택주문");
$("#downloadAllButton").onclick=()=>downloadCsv(orders,"전체주문");
function parseCsv(text){
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i],next=text[i+1];
    if(char==='"'&&quoted&&next==='"'){cell+='"';i++;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(char===","&&!quoted){row.push(cell);cell="";continue}
    if((char==="\n"||char==="\r")&&!quoted){
      if(char==="\r"&&next==="\n")i++;
      row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell="";continue
    }
    cell+=char;
  }
  row.push(cell);if(row.some(value=>value.trim()))rows.push(row);
  return rows;
}
$("#importTrackingButton").onclick=()=>$("#trackingCsvInput").click();
$("#trackingCsvInput").onchange=async event=>{
  const file=event.target.files?.[0],message=$("#bulkMessage");
  if(!file)return;
  const rows=parseCsv((await file.text()).replace(/^\uFEFF/,""));
  const headers=(rows.shift()||[]).map(value=>value.trim());
  const index=name=>headers.indexOf(name);
  const receiptIndex=index("접수번호"),carrierIndex=index("택배사"),trackingIndex=index("운송장번호"),statusIndex=index("처리상태");
  if([receiptIndex,carrierIndex,trackingIndex].some(value=>value<0)){message.textContent="CSV에 접수번호, 택배사, 운송장번호 열이 모두 필요합니다.";event.target.value="";return}
  const updates=[],errors=[];
  rows.forEach((row,line)=>{
    const receipt=String(row[receiptIndex]||"").trim(),carrier=String(row[carrierIndex]||"").trim(),trackingNumber=String(row[trackingIndex]||"").trim().replace(/\s+/g,""),status=String(row[statusIndex]||"").trim();
    const order=orders.find(item=>item.receipt===receipt);
    if(!receipt||!order){errors.push(`${line+2}행: 접수번호 불일치`);return}
    if(!carrier||!trackingNumber||trackingNumber.length<5||trackingNumber.length>80){errors.push(`${line+2}행: 택배사·운송장 확인`);return}
    if(status&&!orderLabels[status]){errors.push(`${line+2}행: 처리상태 오류`);return}
    updates.push({order,patch:{carrier,trackingNumber,status:status||"shipping"}});
  });
  if(errors.length){message.textContent=`업로드 중단: ${errors.slice(0,8).join(" / ")}${errors.length>8?" 외 "+(errors.length-8)+"건":""}`;event.target.value="";return}
  if(!updates.length){message.textContent="적용할 운송장 데이터가 없습니다.";event.target.value="";return}
  if(!confirm(`CSV에서 확인된 ${updates.length}건의 운송장 정보를 적용하시겠습니까?`)){event.target.value="";return}
  message.textContent="운송장 정보를 등록하고 있습니다.";
  const result=await updateOrdersInChunks(updates.map(value=>value.order),item=>updates.find(value=>value.order.id===item.id).patch);
  for(const update of updates)if(!result.failed.includes(update.order.receipt||update.order.id))Object.assign(update.order,update.patch);
  message.textContent=result.failed.length?`${result.succeeded}건 성공, ${result.failed.length}건 실패했습니다.`:`${result.succeeded}건의 운송장을 정상 등록했습니다.`;
  event.target.value="";renderOrders();stats();
};
$("#shareTrackingButton").onclick=async()=>{
  const items=(selectedOrders().length?selectedOrders():visibleOrders()).filter(order=>order.carrier&&order.trackingNumber);
  if(!items.length){$("#bulkMessage").textContent="공유할 운송장 정보가 없습니다.";return}
  const text=items.map(order=>`${order.receipt} | ${order.name} | ${order.carrier} ${order.trackingNumber}`).join("\n");
  try{
    if(navigator.share)await navigator.share({title:"NCC 공동구매 배송정보",text});
    else{await navigator.clipboard.writeText(text);$("#bulkMessage").textContent=`${items.length}건의 배송정보를 클립보드에 복사했습니다.`}
  }catch(error){
    if(error?.name!=="AbortError"){$("#bulkMessage").textContent="공유하지 못했습니다. 브라우저 권한을 확인해 주세요."}
  }
};
