import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendEmailVerification,sendPasswordResetEmail,signOut,reload}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,getDocs,query,where,limit}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const $=selector=>document.querySelector(selector);
const ADMIN_EMAIL="kpa100plus@gmail.com";
const ROLE_ROUTES={center_manager:"center-dashboard.html",center_staff:"center-dashboard.html",partner:"partner-dashboard.html",corporate:"partner-dashboard.html",soleProprietor:"partner-dashboard.html",admin:"admin.html"};
let currentUser;

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  $("#walletLoading").hidden=true;
  $("#authArea").hidden=true;
  $("#authArea").style.display="none";
  $("#verifyArea").hidden=true;
  $("#memberArea").hidden=true;
  if(!user){
    sessionStorage.removeItem("nccMemberProfile");
    $("#authArea").hidden=false;
    $("#authArea").style.display="grid";
    return;
  }
  if(!user.emailVerified&&user.email?.toLowerCase()!==ADMIN_EMAIL){
    $("#verifyEmail").textContent=user.email;
    $("#verifyArea").hidden=false;
    return;
  }
  if(user.email?.toLowerCase()===ADMIN_EMAIL){
    location.replace("admin.html");
    return;
  }
  await loadMember(user);
});

$("#loginForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  await action(()=>signInWithEmailAndPassword(auth,data.email.trim(),data.password),"ë¡ê·¸ì¸ ì ë³´ë¥¼ íì¸í´ ì£¼ì¸ì.");
};

$("#signupForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  await action(async()=>{
    const result=await createUserWithEmailAndPassword(auth,data.email.trim(),data.password);
    await sendEmailVerification(result.user);
    return result;
  },"ê³ì ì ë§ë¤ì§ ëª»íìµëë¤. ì´ë¯¸ ë±ë¡ë ì´ë©ì¼ì´ë©´ ë¡ê·¸ì¸ ëë ë¹ë°ë²í¸ ì¬ì¤ì ì ì´ì©í´ ì£¼ì¸ì.");
};

$("#resetPassword").onclick=async()=>{
  const email=$("#loginForm").elements.email.value.trim();
  if(!email){
    $("#authMessage").textContent="ë¡ê·¸ì¸ ì´ë©ì¼ì ë¨¼ì  ìë ¥í´ ì£¼ì¸ì.";
    return;
  }
  await action(()=>sendPasswordResetEmail(auth,email),"ë¹ë°ë²í¸ ì¬ì¤ì  ë©ì¼ì ë³´ë´ì§ ëª»íìµëë¤.","ë¹ë°ë²í¸ ì¬ì¤ì  ë©ì¼ì ë³´ëìµëë¤.");
};

$("#resendVerification").onclick=async()=>{
  if(currentUser)await action(()=>sendEmailVerification(currentUser),"ì¸ì¦ë©ì¼ì ë³´ë´ì§ ëª»íìµëë¤.","ì¸ì¦ë©ì¼ì ë¤ì ë³´ëìµëë¤.","#verifyMessage");
};

$("#checkVerification").onclick=async()=>{
  if(!currentUser)return;
  await reload(currentUser);
  if(currentUser.emailVerified)location.reload();
  else $("#verifyMessage").textContent="ìì§ ì¸ì¦ëì§ ìììµëë¤. ì´ë©ì¼ì ì¸ì¦ ë§í¬ë¥¼ ë¨¼ì  ëë¬ì£¼ì¸ì.";
};

document.querySelectorAll(".logout-button").forEach(button=>button.onclick=()=>signOut(auth));

async function loadMember(user){
  try{
    const snap=await getDocs(query(collection(db,"members"),where("email","==",user.email),limit(1)));
    if(snap.empty){
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML='<div class="empty-state"><h2>ì°ê²°í  NCC íìì ë³´ê° ììµëë¤.</h2><p>íìê°ì ë ë±ë¡í ì´ë©ì¼ê³¼ íì¬ ì¸ì¦í ì´ë©ì¼ì´ ê°ìì§ íì¸í´ ì£¼ì¸ì.</p><button id="unmatchedLogout" class="text-button logout-button" type="button">ë¤ë¥¸ ê³ì ì¼ë¡ ë¡ê·¸ì¸</button></div>';
      $("#unmatchedLogout").onclick=()=>signOut(auth);
      return;
    }
    const member={id:snap.docs[0].id,...snap.docs[0].data()};
    const accountStatus=member.status||"active";
    if(["paused","blocked"].includes(accountStatus)){
      const statusLabel=accountStatus==="blocked"?"ì°¨ë¨":"ì ì§";
      sessionStorage.removeItem("nccMemberProfile");
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML=`<div class="empty-state"><h2>íì¬ ${statusLabel}ë íìê³ì ìëë¤.</h2><p>ë³¸ì¬ ê´ë¦¬ììê² íììí íì¸ì ìì²­í´ ì£¼ì¸ì.</p><button id="restrictedLogout" class="text-button logout-button" type="button">ë¤ë¥¸ ê³ì ì¼ë¡ ë¡ê·¸ì¸</button></div>`;
      $("#restrictedLogout").onclick=()=>signOut(auth);
      return;
    }
    const role=member.memberType||"consumer";
    if(ROLE_ROUTES[role]){
      location.replace(ROLE_ROUTES[role]);
      return;
    }
    sessionStorage.setItem("nccMemberProfile",JSON.stringify({id:member.id,name:member.name||"",phone:member.phone||"",region:member.region||"",email:member.email||"",memberNumber:member.memberNumber||"",memberType:role}));
    $("#memberName").textContent=member.name||"NCC íì";
    $("#memberNumber").textContent=member.memberNumber||"íìë²í¸ íì¸ì¤";
    $("#memberRegion").textContent=member.region||"ì§ì­ ë¯¸ë±ë¡";
    $("#memberType").textContent="ìë¹ìíì";
    $("#memberContact").textContent=`${member.phone||"ì°ë½ì² ë¯¸ë±ë¡"} Â· ${member.email}`;
    $("#memberArea").hidden=false;
  }catch(error){
    console.error(error);
    $("#memberArea").hidden=false;
    $("#memberArea").innerHTML='<div class="empty-state">íìì ë³´ë¥¼ ë¶ë¬ì¤ì§ ëª»íìµëë¤. Firestore íì ë³¸ì¸ì¡°í ê¶íì íì¸í´ ì£¼ì¸ì.</div>';
  }
}

async function action(fn,errorText,successText="",target="#authMessage"){
  const element=$(target);
  element.textContent="ì²ë¦¬ ì¤ìëë¤.";
  try{
    await fn();
    element.textContent=successText;
  }catch(error){
    console.error(error);
    element.textContent=errorText;
  }
}
