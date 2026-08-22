import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,doc,updateDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),ADMIN_EMAIL="kpa100plus@gmail.com",$=selector=>document.querySelector(selector);
const statusLabels={pending:"검토 대기",reviewing:"검토 중",approved:"승인",rejected:"보완 요청",published:"공개 완료"};
let records=[];

$("#adminLoginButton").onclick=async()=>{try{$("#adminOperationMessage").textContent="로그인 중입니다.";await signInWithEmailAndPassword(auth,$("#adminEmail").value.trim(),$("#adminPassword").value);$("#adminOperationMessage").textContent=""}catch(error){console.error(error);$("#adminOperationMessage").textContent="관리자 로그인 정보를 확인해 주세요."}};
$("#adminLogoutButton").onclick=()=>signOut(auth);
$("#operationRefresh").onclick=loadRecords;
$("#operationSearch").oninput=render;
$("#operationType").onchange=render;
$("#operationStatus").onchange=render;

onAuthStateChanged(auth,async user=>{const admin=user?.email?.toLowerCase()===ADMIN_EMAIL;$("#adminOperationLogin").hidden=admin;$("#adminOperationArea").hidden=!admin;if(user&&!admin)await signOut(auth);if(admin)await loadRecords()});

async function loadRecords(){
  $("#adminOperationList").innerHTML='<div class="role-empty">운영 등록내역을 불러오고 있습니다.</div>';
  try{
    const [partnerSnap,centerSnap]=await Promise.all([getDocs(collection(db,"partnerSubmissions")),getDocs(collection(db,"centerActivities"))]);
    records=[...partnerSnap.docs.map(item=>({id:item.id,recordType:"partner",...item.data()})),...centerSnap.docs.map(item=>({id:item.id,recordType:"center",...item.data()}))].sort((a,b)=>timestampValue(b.createdAt)-timestampValue(a.createdAt));render();
  }catch(error){console.error(error);$("#adminOperationList").innerHTML='<div class="role-empty">등록내역을 불러오지 못했습니다. Firestore 관리자 권한을 확인해 주세요.</div>'}
}

function render(){
  const word=$("#operationSearch").value.trim().toLowerCase(),type=$("#operationType").value,status=$("#operationStatus").value;
  const filtered=records.filter(record=>(!type||record.recordType===type)&&(!status||record.status===status)&&(!word||[record.title,record.partnerName,record.centerName,record.region,record.category,record.summary,record.description].some(value=>String(value||"").toLowerCase().includes(word))));
  $("#adminOperationList").innerHTML=filtered.length?filtered.map(editor).join(""):'<div class="role-empty">조건에 맞는 등록내역이 없습니다.</div>';
  document.querySelectorAll("[data-operation-save]").forEach(button=>button.onclick=saveRecord);
}

function editor(record){
  const collectionName=record.recordType==="partner"?"partnerSubmissions":"centerActivities";
  const category=record.recordType==="partner"?({benefit:"회원 혜택",experience:"무료 경험",groupbuy:"공동구매"}[record.submissionType]||"파트너 제안"):({local_benefit:"지역 혜택",partner_link:"파트너 연결",event:"지역 행사",member_support:"회원 지원"}[record.activityType]||"센터 활동");
  const owner=record.recordType==="partner"?(record.partnerName||"파트너"):(record.centerName||"소비자센터");
  const detail=[category,record.benefitClass&&`${record.benefitClass} BENEFIT`,record.category,record.region,record.startDate&&`${record.startDate} ~ ${record.endDate||""}`].filter(Boolean).join(" · ");
  const summary=record.summary||record.description||"상세 내용 없음";
  return `<article class="operation-item"><div class="operation-meta"><span class="status-chip">${escapeHtml(statusLabels[record.status]||record.status)}</span><span>${escapeHtml(record.recordType==="partner"?"파트너 제안":"센터 활동")}</span><span>${escapeHtml(owner)}</span></div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(detail)}</p><p>${escapeHtml(summary)}</p><div class="operation-item-admin"><label>처리 상태<select id="status-${collectionName}-${record.id}">${Object.entries(statusLabels).map(([value,label])=>`<option value="${value}" ${record.status===value?"selected":""}>${label}</option>`).join("")}</select></label><label>관리자 안내<textarea id="memo-${collectionName}-${record.id}" maxlength="1000" placeholder="보완 요청이나 승인 안내를 입력하세요.">${escapeHtml(record.adminMemo||"")}</textarea></label><button class="role-button" data-operation-save="${record.id}" data-collection="${collectionName}" type="button">상태 저장</button></div></article>`;
}

async function saveRecord(event){
  const button=event.currentTarget,id=button.dataset.operationSave,collectionName=button.dataset.collection,record=records.find(item=>item.id===id&&((item.recordType==="partner"?"partnerSubmissions":"centerActivities")===collectionName));if(!record)return;
  const status=$("#status-"+collectionName+"-"+id).value,adminMemo=$("#memo-"+collectionName+"-"+id).value.trim();button.disabled=true;$("#operationSaveMessage").textContent="처리 상태를 저장하고 있습니다.";
  try{await updateDoc(doc(db,collectionName,id),{status,adminMemo,updatedAt:serverTimestamp()});record.status=status;record.adminMemo=adminMemo;$("#operationSaveMessage").textContent=`${record.title} 상태를 ${statusLabels[status]}(으)로 저장했습니다.`;render()}catch(error){console.error(error);$("#operationSaveMessage").textContent="상태를 저장하지 못했습니다. Firestore 관리자 권한을 확인해 주세요."}finally{button.disabled=false}
}

function timestampValue(value){return value?.toMillis?.()||0}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
