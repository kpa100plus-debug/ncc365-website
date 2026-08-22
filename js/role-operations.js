import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getFirestore,addDoc,collection,getDocs,query,where,orderBy,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),db=getFirestore(app);
const statusLabels={pending:"검토 대기",reviewing:"검토 중",approved:"승인",rejected:"보완 요청",published:"공개 완료"};

window.addEventListener("ncc:role-ready",event=>startOperations(event.detail),{once:true});

async function startOperations(context){
  const form=document.querySelector("#operationForm"),list=document.querySelector("#operationList");
  if(!form||!list)return;
  const region=form.elements.region;
  if(region&&!region.value)region.value=context.member.region||"";
  form.addEventListener("submit",event=>submitOperation(event,context));
  await loadOperations(context);
}

async function submitOperation(event,context){
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector("button[type=submit]"),message=document.querySelector("#operationMessage");
  button.disabled=true;message.textContent="등록 내용을 저장하고 있습니다.";
  try{
    const data=new FormData(form);
    if(context.dashboard==="partner"){
      await addDoc(collection(db,"partnerSubmissions"),partnerPayload(data,context));
    }else{
      await addDoc(collection(db,"centerActivities"),centerPayload(data,context));
    }
    const region=data.get("region");form.reset();if(form.elements.region)form.elements.region.value=region||context.member.region||"";
    message.textContent="등록되었습니다. 본사 검토 상태는 아래에서 확인할 수 있습니다.";
    await loadOperations(context);
  }catch(error){
    console.error(error);message.textContent=permissionMessage(error);
  }finally{button.disabled=false}
}

function partnerPayload(data,{member}){
  return{
    memberId:member.id,partnerId:member.partnerId||member.id,partnerName:member.partnerName||member.name||"NCC 파트너",
    submissionType:String(data.get("submissionType")||"benefit"),title:String(data.get("title")||"").trim(),
    benefitClass:String(data.get("benefitClass")||"PREMIUM"),category:String(data.get("category")||"").trim(),
    region:String(data.get("region")||"").trim(),summary:String(data.get("summary")||"").trim(),
    quantity:numberValue(data.get("quantity")),regularPrice:numberValue(data.get("regularPrice")),
    memberPrice:numberValue(data.get("memberPrice")),deliveryFee:numberValue(data.get("deliveryFee")),
    startDate:String(data.get("startDate")||""),endDate:String(data.get("endDate")||""),
    reviewRequirement:String(data.get("reviewRequirement")||"").trim(),status:"pending",adminMemo:"",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  };
}

function centerPayload(data,{member}){
  return{
    memberId:member.id,centerCode:member.centerCode||"",centerName:member.centerName||"소속 센터 미등록",
    activityType:String(data.get("activityType")||"local_benefit"),title:String(data.get("title")||"").trim(),
    partnerName:String(data.get("partnerName")||"").trim(),region:String(data.get("region")||"").trim(),
    startDate:String(data.get("startDate")||""),endDate:String(data.get("endDate")||""),
    description:String(data.get("description")||"").trim(),status:"pending",adminMemo:"",
    createdAt:serverTimestamp(),updatedAt:serverTimestamp()
  };
}

async function loadOperations(context){
  const list=document.querySelector("#operationList"),collectionName=context.dashboard==="partner"?"partnerSubmissions":"centerActivities";
  list.innerHTML='<div class="role-empty">등록 내역을 불러오고 있습니다.</div>';
  try{
    let snap;
    try{snap=await getDocs(query(collection(db,collectionName),where("memberId","==",context.member.id),orderBy("createdAt","desc")))}
    catch(error){if(error.code!=="failed-precondition")throw error;snap=await getDocs(query(collection(db,collectionName),where("memberId","==",context.member.id)))}
    const records=snap.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>timestampValue(b.createdAt)-timestampValue(a.createdAt));
    list.innerHTML=records.length?records.map(record=>renderRecord(record,context.dashboard)).join(""):'<div class="role-empty">아직 등록한 내용이 없습니다.</div>';
  }catch(error){console.error(error);list.innerHTML=`<div class="role-empty">${escapeHtml(permissionMessage(error))}</div>`}
}

function renderRecord(record,dashboard){
  const kind=dashboard==="partner"?({benefit:"혜택",experience:"무료 경험",groupbuy:"공동구매"}[record.submissionType]||"운영 제안"):({local_benefit:"지역 혜택",partner_link:"파트너 연결",event:"지역 행사",member_support:"회원 지원"}[record.activityType]||"센터 활동");
  const date=record.createdAt?.toDate?.().toLocaleDateString("ko-KR")||"방금 등록";
  const detail=dashboard==="partner"?[record.benefitClass&&`${record.benefitClass} BENEFIT`,record.category,record.region].filter(Boolean).join(" · "):[record.centerName,record.partnerName,record.region].filter(Boolean).join(" · ");
  const summary=record.summary||record.description||"등록 내용 확인 중";
  return `<article class="operation-item"><div class="operation-meta"><span class="status-chip">${escapeHtml(statusLabels[record.status]||record.status)}</span><span>${escapeHtml(kind)}</span><span>${escapeHtml(date)}</span></div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(detail)}</p><p>${escapeHtml(summary)}</p>${record.adminMemo?`<p><strong>본사 안내:</strong> ${escapeHtml(record.adminMemo)}</p>`:""}</article>`;
}

function numberValue(value){const number=Number(value);return Number.isFinite(number)&&number>=0?Math.round(number):0}
function timestampValue(value){return value?.toMillis?.()||0}
function permissionMessage(error){return error?.code==="permission-denied"?"Firebase 운영 규칙 반영 후 등록·조회할 수 있습니다.":(error?.message||"처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
