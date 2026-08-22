import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,query,where,limit}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),dashboard=document.body.dataset.dashboard;
const ADMIN_EMAIL="kpa100plus@gmail.com";
const centerRoles=["center_manager","center_staff"],partnerRoles=["partner","corporate","soleProprietor"];
const roleLabels={center_manager:"센터장",center_staff:"센터 팀원",partner:"파트너회원",corporate:"법인 파트너",soleProprietor:"개인사업자 파트너"};
const routes={consumer:"wallet.html",center_manager:"center-dashboard.html",center_staff:"center-dashboard.html",partner:"partner-dashboard.html",corporate:"partner-dashboard.html",soleProprietor:"partner-dashboard.html",admin:"admin.html"};

onAuthStateChanged(auth,async user=>{
  if(!user){location.replace(`wallet.html?next=${encodeURIComponent(location.pathname.split("/").pop())}`);return}
  if(user.email?.toLowerCase()===ADMIN_EMAIL){location.replace("admin.html");return}
  try{
    const snap=await getDocs(query(collection(db,"members"),where("email","==",user.email),limit(1)));
    if(snap.empty)throw new Error("연결된 NCC 회원정보가 없습니다.");
    const member={id:snap.docs[0].id,...snap.docs[0].data()},role=member.memberType||"consumer";
    const accountStatus=member.status||"active";
    if(["paused","blocked"].includes(accountStatus)){
      showDenied(`현재 ${accountStatus==="blocked"?"차단":"정지"}된 회원계정입니다. 본사 관리자에게 확인을 요청해 주세요.`,"wallet.html");
      return;
    }
    const allowed=dashboard==="center"?centerRoles.includes(role):partnerRoles.includes(role);
    if(!allowed){showDenied(`현재 계정은 ${roleLabels[role]||"소비자회원"} 권한입니다.`,routes[role]||"wallet.html");return}
    render(member,role);
  }catch(error){console.error(error);showDenied(error.message||"회원 권한을 확인하지 못했습니다.","wallet.html")}
});

function render(member,role){
  document.querySelector("#roleLoading").hidden=true;document.querySelector("#roleContent").hidden=false;
  document.querySelector("#roleName").textContent=member.name||"NCC 회원";
  document.querySelector("#roleLabel").textContent=roleLabels[role]||role;
  document.querySelector("#roleNumber").textContent=member.memberNumber||"회원번호 확인 중";
  document.querySelector("#roleRegion").textContent=member.region||"지역 미등록";
  document.querySelector("#roleOrganization").textContent=dashboard==="center"?(member.centerName||"소속 센터 확인 중"):(member.partnerName||"파트너 업체 확인 중");
  document.querySelector("#logoutButton").onclick=()=>signOut(auth).then(()=>location.replace("wallet.html"));
  window.dispatchEvent(new CustomEvent("ncc:role-ready",{detail:{member,role,dashboard}}));
}

function showDenied(message,target){const loading=document.querySelector("#roleLoading");loading.className="role-denied";loading.innerHTML=`<h2>접근 권한을 확인해 주세요</h2><p>${escapeHtml(message)}</p><a class="role-button" href="${target}">내 페이지로 이동</a>`}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
