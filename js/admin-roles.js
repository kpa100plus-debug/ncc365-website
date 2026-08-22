import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,doc,updateDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),ADMIN_EMAIL="kpa100plus@gmail.com",$=selector=>document.querySelector(selector);
const labels={consumer:"ìë¹ìíì",center_manager:"ì¼í°ì¥",center_staff:"ì¼í° íì",partner:"íí¸ëíì",corporate:"ë²ì¸ íí¸ë",soleProprietor:"ê°ì¸ì¬ìì íí¸ë",admin:"ë³¸ì¬ ê´ë¦¬ì"};
const statusLabels={active:"íì±",paused:"ì ì§",blocked:"ì°¨ë¨"};
let members=[];

$("#adminLoginButton").onclick=async()=>{
  $("#adminRoleMessage").textContent="ë¡ê·¸ì¸ ì¤ìëë¤.";
  try{await signInWithEmailAndPassword(auth,$("#adminEmail").value.trim(),$("#adminPassword").value);$("#adminRoleMessage").textContent=""}catch(error){console.error(error);$("#adminRoleMessage").textContent="ê´ë¦¬ì ë¡ê·¸ì¸ ì ë³´ë¥¼ íì¸í´ ì£¼ì¸ì."}
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
  $("#roleMemberList").innerHTML='<div class="role-empty">íìì ë³´ë¥¼ ë¶ë¬ì¤ê³  ììµëë¤.</div>';
  try{const snap=await getDocs(collection(db,"members"));members=snap.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ko"));render()}catch(error){console.error(error);$("#roleMemberList").innerHTML='<div class="role-empty">íìì ë³´ë¥¼ ë¶ë¬ì¤ì§ ëª»íìµëë¤. ê´ë¦¬ì ê¶íì íì¸í´ ì£¼ì¸ì.</div>'}
}

function render(){
  const word=$("#roleSearch").value.trim().toLowerCase(),role=$("#roleFilter").value;
  const filtered=members.filter(member=>(!role||(member.memberType||"consumer")===role)&&(!word||[member.name,member.email,member.phone,member.centerName,member.centerCode,member.partnerName,member.partnerId].some(value=>String(value||"").toLowerCase().includes(word))));
  $("#roleMemberList").innerHTML=filtered.length?filtered.map(editor).join(""):'<div class="role-empty">ì¡°ê±´ì ë§ë íìì´ ììµëë¤.</div>';
  document.querySelectorAll("[data-role-save]").forEach(button=>button.onclick=saveRole);
}

function editor(member){
  const role=member.memberType||"consumer";
  return `<article class="role-editor"><div class="role-person"><b>${escapeHtml(member.name||"ì´ë¦ ë¯¸ë±ë¡")}</b><small>${escapeHtml(member.memberNumber||"ë¯¸ë°ê¸")} Â· ${escapeHtml(member.email||"ì´ë©ì¼ ìì")} Â· ${escapeHtml(member.phone||"")} Â· ìí ${escapeHtml(statusLabels[member.status||"active"]||member.status||"íì±")}</small></div><label>íì ì­í <select id="memberType-${member.id}">${["consumer","center_manager","center_staff","partner"].map(value=>`<option value="${value}" ${role===value||(value==="partner"&&["corporate","soleProprietor"].includes(role))?"selected":""}>${labels[value]}</option>`).join("")}</select></label><label>ì¼í°ëª / ìì²´ëª<input id="organization-${member.id}" maxlength="100" value="${escapeHtml(member.centerName||member.partnerName||"")}" placeholder="ììëª"></label><label>ì¼í°ì½ë / íí¸ëID<input id="organizationId-${member.id}" maxlength="50" value="${escapeHtml(member.centerCode||member.partnerId||"")}" placeholder="ìë³ì½ë"></label><button class="role-button" data-role-save="${member.id}" type="button">ê¶í ì ì¥</button></article>`;
}

async function saveRole(event){
  const id=event.currentTarget.dataset.roleSave,member=members.find(item=>item.id===id);if(!member)return;
  const memberType=$("#memberType-"+id).value,organization=$("#organization-"+id).value.trim(),organizationId=$("#organizationId-"+id).value.trim(),center=["center_manager","center_staff"].includes(memberType);
  if(memberType!=="consumer"&&(!organization||!organizationId)){
    $("#roleSaveMessage").textContent="ì¼í°Â·íí¸ë ê¶íì ììëªê³¼ ìë³ì½ëë¥¼ ëª¨ë ìë ¥í´ì¼ ì ì¥í  ì ììµëë¤.";
    return;
  }
  const payload={memberType,centerName:center?organization:"",centerCode:center?organizationId:"",partnerName:memberType==="partner"?organization:"",partnerId:memberType==="partner"?organizationId:"",roleUpdatedAt:serverTimestamp(),updatedAt:serverTimestamp()};
  event.currentTarget.disabled=true;$("#roleSaveMessage").textContent=`${member.name||"íì"} ê¶íì ì ì¥íê³  ììµëë¤.`;
  try{await updateDoc(doc(db,"members",id),payload);Object.assign(member,payload);$("#roleSaveMessage").textContent=`${member.name||"íì"}ì(ë¥¼) ${labels[memberType]}ì¼ë¡ ì ì¥íìµëë¤.`}catch(error){console.error(error);$("#roleSaveMessage").textContent="ê¶íì ì ì¥íì§ ëª»íìµëë¤. Firestore ê´ë¦¬ì ìì  ê¶íì íì¸í´ ì£¼ì¸ì."}finally{event.currentTarget.disabled=false}
}

function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
