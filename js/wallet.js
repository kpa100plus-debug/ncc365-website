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
  await user.getIdToken(true);
  await loadMember(user);
});

$("#loginForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  await action(()=>signInWithEmailAndPassword(auth,data.email.trim(),data.password),"로그인 정보를 확인해 주세요.");
};

$("#signupForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  await action(async()=>{
    const result=await createUserWithEmailAndPassword(auth,data.email.trim(),data.password);
    await sendEmailVerification(result.user);
    return result;
  },"계정을 만들지 못했습니다. 이미 등록된 이메일이면 로그인 또는 비밀번호 재설정을 이용해 주세요.");
};

$("#resetPassword").onclick=async()=>{
  const email=$("#loginForm").elements.email.value.trim();
  if(!email){
    $("#authMessage").textContent="로그인 이메일을 먼저 입력해 주세요.";
    return;
  }
  await action(()=>sendPasswordResetEmail(auth,email),"비밀번호 재설정 메일을 보내지 못했습니다.","비밀번호 재설정 메일을 보냈습니다.");
};

$("#resendVerification").onclick=async()=>{
  if(currentUser)await action(()=>sendEmailVerification(currentUser),"인증메일을 보내지 못했습니다.","인증메일을 다시 보냈습니다.","#verifyMessage");
};

$("#checkVerification").onclick=async()=>{
  if(!currentUser)return;
  await reload(currentUser);
  if(currentUser.emailVerified){
    await currentUser.getIdToken(true);
    location.reload();
  }
  else $("#verifyMessage").textContent="아직 인증되지 않았습니다. 이메일의 인증 링크를 먼저 눌러주세요.";
};

document.querySelectorAll(".logout-button").forEach(button=>button.onclick=()=>signOut(auth));

async function loadMember(user){
  try{
    const snap=await getDocs(query(collection(db,"members"),where("email","==",user.email),limit(1)));
    if(snap.empty){
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML='<div class="empty-state"><h2>연결할 NCC 회원정보가 없습니다.</h2><p>회원가입 때 등록한 이메일과 현재 인증한 이메일이 같은지 확인해 주세요.</p><button id="unmatchedLogout" class="text-button logout-button" type="button">다른 계정으로 로그인</button></div>';
      $("#unmatchedLogout").onclick=()=>signOut(auth);
      return;
    }
    const member={id:snap.docs[0].id,...snap.docs[0].data()};
    const accountStatus=member.status||"active";
    if(["paused","blocked"].includes(accountStatus)){
      const statusLabel=accountStatus==="blocked"?"차단":"정지";
      sessionStorage.removeItem("nccMemberProfile");
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML=`<div class="empty-state"><h2>현재 ${statusLabel}된 회원계정입니다.</h2><p>본사 관리자에게 회원상태 확인을 요청해 주세요.</p><button id="restrictedLogout" class="text-button logout-button" type="button">다른 계정으로 로그인</button></div>`;
      $("#restrictedLogout").onclick=()=>signOut(auth);
      return;
    }
    const role=member.memberType||"consumer";
    if(ROLE_ROUTES[role]){
      location.replace(ROLE_ROUTES[role]);
      return;
    }
    sessionStorage.setItem("nccMemberProfile",JSON.stringify({id:member.id,name:member.name||"",phone:member.phone||"",region:member.region||"",email:member.email||"",memberNumber:member.memberNumber||"",memberType:role}));
    $("#memberName").textContent=member.name||"NCC 회원";
    $("#memberNumber").textContent=member.memberNumber||"회원번호 확인중";
    $("#memberRegion").textContent=member.region||"지역 미등록";
    $("#memberType").textContent="소비자회원";
    $("#memberContact").textContent=`${member.phone||"연락처 미등록"} · ${member.email}`;
    $("#memberArea").hidden=false;
  }catch(error){
    console.error(error);
    $("#memberArea").hidden=false;
    $("#memberArea").innerHTML='<div class="empty-state">회원정보를 불러오지 못했습니다. Firestore 회원 본인조회 권한을 확인해 주세요.</div>';
  }
}

async function action(fn,errorText,successText="",target="#authMessage"){
  const element=$(target);
  element.textContent="처리 중입니다.";
  try{
    await fn();
    element.textContent=successText;
  }catch(error){
    console.error(error);
    element.textContent=errorText;
  }
}
