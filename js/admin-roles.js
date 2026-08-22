import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,doc,updateDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),ADMIN_EMAIL="kpa100plus@gmail.com",$=selector=>document.querySelector(selector);
const labels={consumer:"소비자회원",center_manager:"센터장",center_staff:"센터 팀원",partner:"파트너회원",corporate:"법인 파트너",soleProprietor:"개인사업자 파트너",admin:"본사 관리자"};
const statusLabels={active:"활성",paused:"정지",blocked:"차단"};
let members=[];

$("#adminLoginButton").onclick=async()=>{
  $("#adminRoleMessage").textContent="로그인 중입니다.";
  try{await signInWithEmailAndPassword(auth,$("#adminEmail").value.trim(),$("#adminPassword").value);$("#adminRoleMessage").textContent=""}catch(error){console.error(error);$("#adminRoleMessage").textContent="관리자 로그인 정보를 확인해 주세요."}
};
$("#adminLogoutButton").onclick=()=>signOut(auth);
$("#roleRefresh").onclick=loadMembers;
$("#roleSearch").oninput=render;
$("#roleFilter").onchange=render;

onAuthStateChanged(auth,async user=>{
  const admin=user?.email?.toLowerCase()===ADMIN_EMAIL;
  $("#adminRoleLogin").hidden=admin;$("#adminRoleArea").hidden=!admin;
  if(user&&!admin)await signOut(auth);
  if(admin)await loadMembers();
});

async function loadMembers(){
  $("#roleMemberList").innerHTML='<div class="role-empty">회원정보를 불러오고 있습니다.</div>';
  try{const snap=await getDocs(collection(db,"members"));members=snap.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ko"));render()}catch(error){console.error(error);$("#roleMemberList").innerHTML='<div class="role-empty">회원정보를 불러오지 못했습니다. 관리자 권한을 확인해 주세요.</div>'}
}

function render(){
  const word=$("#roleSearch").value.trim().toLowerCase(),role=$("#roleFilter").value;
  const filtered=members.filter(member=>(!role||(member.memberType||"consumer")===role)&&(!word||[member.name,member.email,member.phone,member.centerName,member.centerCode,member.partnerName,member.partnerId].some(value=>String(value||"").toLowerCase().includes(word))));
  $("#roleMemberList").innerHTML=filtered.length?filtered.map(editor).join(""):'<div class="role-empty">조건에 맞는 회원이 없습니다.</div>';
  document.querySelectorAll("[data-role-save]").forEach(button=>button.onclick=saveRole);
}

function editor(member){
  const role=member.memberType||"consumer";
  return `<article class="role-editor"><div class="role-person"><b>${escapeHtml(member.name||"이름 미등록")}</b><small>${escapeHtml(member.memberNumber||"미발급")} · ${escapeHtml(member.email||"이메일 없음")} · ${escapeHtml(member.phone||"")} · 상태 ${escapeHtml(statusLabels[member.status||"active"]||member.status||"활성")}</small></div><label>회원 역할<select id="memberType-${member.id}">${["consumer","center_manager","center_staff","partner"].map(value=>`<option value="${value}" ${role===value||(value==="partner"&&["corporate","soleProprietor"].includes(role))?"selected":""}>${labels[value]}</option>`).join("")}</select></label><label>센터명 / 업체명<input id="organization-${member.id}" maxlength="100" value="${escapeHtml(member.centerName||member.partnerName||"")}" placeholder="소속명"></label><label>센터코드 / 파트너ID<input id="organizationId-${member.id}" maxlength="50" value="${escapeHtml(member.centerCode||member.partnerId||"")}" placeholder="식별코드"></label><button class="role-button" data-role-save="${member.id}" type="button">권한 저장</button></article>`;
}

async function saveRole(event){
  const id=event.currentTarget.dataset.roleSave,member=members.find(item=>item.id===id);if(!member)return;
  const memberType=$("#memberType-"+id).value,organization=$("#organization-"+id).value.trim(),organizationId=$("#organizationId-"+id).value.trim(),center=["center_manager","center_staff"].includes(memberType);
  if(memberType!=="consumer"&&(!organization||!organizationId)){
    $("#roleSaveMessage").textContent="센터·파트너 권한은 소속명과 식별코드를 모두 입력해야 저장할 수 있습니다.";
    return;
  }
  const payload={memberType,centerName:center?organization:"",centerCode:center?organizationId:"",partnerName:memberType==="partner"?organization:"",partnerId:memberType==="partner"?organizationId:"",roleUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  event.currentTarget.disabled=true;$("#roleSaveMessage").textContent=`${member.name||"회원"} 권한을 저장하고 있습니다.`;
  try{await updateDoc(doc(db,"members",id),payload);Object.assign(member,payload);$("#roleSaveMessage").textContent=`${member.name||"회원"}을(를) ${labels[memberType]}으로 저장했습니다.`}catch(error){console.error(error);$("#roleSaveMessage").textContent="권한을 저장하지 못했습니다. Firestore 관리자 수정 권한을 확인해 주세요."}finally{event.currentTarget.disabled=false}
}

function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
