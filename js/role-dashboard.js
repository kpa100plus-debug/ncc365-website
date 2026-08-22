import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,query,where,limit}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),dashboard=document.body.dataset.dashboard;
const centerRoles=["center_manager","center_staff"],partnerRoles=["partner","corporate","soleProprietor"];
const roleLabels={center_manager:"ì¼í°ì¥",center_staff:"ì¼í° íì",partner:"íí¸ëíì",corporate:"ë²ì¸ íí¸ë",soleProprietor:"ê°ì¸ì¬ìì íí¸ë"};
const routes={consumer:"wallet.html",center_manager:"center-dashboard.html",center_staff:"center-dashboard.html",partner:"partner-dashboard.html",corporate:"partner-dashboard.html",soleProprietor:"partner-dashboard.html",admin:"admin.html"};

onAuthStateChanged(auth,async user=>{
  if(!user){location.replace(`wallet.html?next=${encodeURIComponent(location.pathname.split("/").pop())}`);return}
  try{
    const snap=await getDocs(query(collection(db,"members"),where("email","==",user.email),limit(1)));
    if(snap.empty)throw new Error("ì°ê²°ë NCC íìì ë³´ê° ììµëë¤.");
    const member={id:snap.docs[0].id,...snap.docs[0].data()},role=member.memberType||"consumer";
    const accountStatus=member.status||"active";
    if(["paused","blocked"].includes(accountStatus)){
      showDenied(`íì¬ ${accountStatus==="blocked"?"ì°¨ë¨":"ì ì§"}ë íìê³ì ìëë¤. ë³¸ì¬ ê´ë¦¬ììê² íì¸ì ìì²­í´ ì£¼ì¸ì.`,"wallet.html");
      return;
    }
    const allowed=dashboard==="center"?centerRoles.includes(role):partnerRoles.includes(role);
    if(!allowed){showDenied(`íì¬ ê³ì ì ${roleLabels[role]||"ìë¹ìíì"} ê¶íìëë¤.`,routes[role]||"wallet.html");return}
    render(member,role);
  }catch(error){console.error(error);showDenied(error.message||"íì ê¶íì íì¸íì§ ëª»íìµëë¤.","wallet.html")}
});

function render(member,role){
  document.querySelector("#roleLoading").hidden=true;document.querySelector("#roleContent").hidden=false;
  document.querySelector("#roleName").textContent=member.name||"NCC íì";
  document.querySelector("#roleLabel").textContent=roleLabels[role]||role;
  document.querySelector("#roleNumber").textContent=member.memberNumber||"íìë²í¸ íì¸ ì¤";
  document.querySelector("#roleRegion").textContent=member.region||"ì§ì­ ë¯¸ë±ë¡";
  document.querySelector("#roleOrganization").textContent=dashboard==="center"?(member.centerName||"ìì ì¼í° íì¸ ì¤"):(member.partnerName||"íí¸ë ìì²´ íì¸ ì¤");
  document.querySelector("#logoutButton").onclick=()=>signOut(auth).then(()=>location.replace("wallet.html"));
  window.dispatchEvent(new CustomEvent("ncc:role-ready",{detail:{member,role,dashboard}}));
}

function showDenied(message,target){const loading=document.querySelector("#roleLoading");loading.className="role-denied";loading.innerHTML=`<h2>ì ê·¼ ê¶íì íì¸í´ ì£¼ì¸ì</h2><p>${escapeHtml(message)}</p><a class="role-button" href="${target}">ë´ íì´ì§ë¡ ì´ë</a>`}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
