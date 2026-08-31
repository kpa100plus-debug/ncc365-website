import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithEmailAndPassword,signInWithPopup,createUserWithEmailAndPassword,sendEmailVerification,sendPasswordResetEmail,signOut,reload,updatePassword}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{getFirestore,collection,doc,getDoc,getDocs,query,where,limit,updateDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import{firebaseConfig}from"./platform-config.js";
import{formatCardholderName,formatCardRegion,formatCardMemberType}from"./member-card-english.js?v=20260824-1";

const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app);
auth.languageCode="ko";
const db=getFirestore(app);
const $=selector=>document.querySelector(selector);
const ADMIN_EMAIL="kpa100plus@gmail.com";
const ROLE_ROUTES={center_manager:"center-dashboard.html",center_staff:"center-dashboard.html",partner:"partner-dashboard.html",corporate:"partner-dashboard.html",soleProprietor:"partner-dashboard.html",admin:"admin.html"};
let currentUser;
let forcedPasswordMemberId="";

const memberCard=$("#memberCard");
const memberCardFront=$("#memberCardFront");
const memberCardBack=$("#memberCardBack");
const flipMemberCard=$("#flipMemberCard");
const cardFlipStatus=$("#cardFlipStatus");

function setMemberCardSide(showBack){
  if(!memberCard||!flipMemberCard)return;
  memberCard.classList.toggle("is-flipped",showBack);
  memberCard.setAttribute("aria-pressed",String(showBack));
  memberCard.setAttribute("aria-label",showBack
    ?"NCC 디지털 회원카드 뒷면. 누르면 앞면을 볼 수 있습니다."
    :"NCC 디지털 회원카드 앞면. 누르면 뒷면을 볼 수 있습니다.");
  memberCardFront?.setAttribute("aria-hidden",String(showBack));
  memberCardBack?.setAttribute("aria-hidden",String(!showBack));
  flipMemberCard.innerHTML=showBack
    ?'<span aria-hidden="true">↻</span> 카드 앞면 보기'
    :'<span aria-hidden="true">↻</span> 카드 뒷면 보기';
  if(cardFlipStatus)cardFlipStatus.textContent=showBack
    ?"카드 뒷면이 표시되었습니다."
    :"카드 앞면이 표시되었습니다.";
}

function toggleMemberCard(){
  setMemberCardSide(!memberCard?.classList.contains("is-flipped"));
}

if(memberCard&&flipMemberCard){
  memberCard.addEventListener("click",toggleMemberCard);
  memberCard.addEventListener("keydown",event=>{
    if(event.key!=="Enter"&&event.key!==" ")return;
    event.preventDefault();
    toggleMemberCard();
  });
  flipMemberCard.addEventListener("click",toggleMemberCard);
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  setMemberCardSide(false);
  $("#walletLoading").hidden=true;
  $("#authArea").hidden=true;
  $("#authArea").style.display="none";
  $("#verifyArea").hidden=true;
  $("#forcedPasswordArea").hidden=true;
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
  const email=data.email.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    $("#authMessage").textContent="이메일 형식을 확인해 주세요.";
    return;
  }
  const button=event.currentTarget.querySelector('button[type="submit"]');
  button.disabled=true;button.textContent="로그인 확인 중...";
  try{await signInWithEmailAndPassword(auth,email,data.password);$("#authMessage").textContent=""}
  catch(error){const code=String(error?.code||"");console.error(error);$("#authMessage").textContent=code.includes("wrong-password")||code.includes("invalid-credential")?"비밀번호가 올바르지 않습니다. 다시 확인해 주세요.":code.includes("user-not-found")?"등록되지 않은 이메일입니다.":code.includes("too-many-requests")?"로그인 시도가 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.":code.includes("network-request-failed")?"인터넷 연결을 확인한 뒤 다시 시도해 주세요.":"로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";$("#authMessage").scrollIntoView({behavior:"smooth",block:"center"})}
  finally{button.disabled=false;button.textContent="회원 로그인"}
};

$("#googleLogin").onclick=async()=>{
  const button=$("#googleLogin");
  button.disabled=true;
  button.textContent="Google 계정을 확인 중...";
  try{
    const provider=new GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    await signInWithPopup(auth,provider);
    $("#authMessage").textContent="";
  }catch(error){
    const code=String(error?.code||"");
    console.error(error);
    $("#authMessage").textContent=code.includes("popup-closed-by-user")
      ?"Google 계정 선택을 취소했습니다."
      :code.includes("account-exists-with-different-credential")
        ?"이 이메일은 비밀번호 로그인으로 이미 등록되어 있습니다. 먼저 이메일 로그인 후 내 정보의 ‘Google 계정 연결’을 이용해 주세요."
        :code.includes("unauthorized-domain")
          ?"Google 로그인 도메인 설정을 확인 중입니다. 잠시 후 다시 시도해 주세요."
          :"Google로 로그인하지 못했습니다. 회원가입 이메일과 같은 Google 계정인지 확인해 주세요.";
  }finally{
    button.disabled=false;
    button.innerHTML='<span class="google-login-mark" aria-hidden="true">G</span> Google로 로그인';
  }
};

$("#signupForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  await action(async()=>{
    const result=await createUserWithEmailAndPassword(auth,data.email.trim(),data.password);
    await sendEmailVerification(result.user);
    return result;
  },"계정 연결을 시작하지 못했습니다. 이미 온라인 계정이 있는 이메일이면 회원 로그인 또는 비밀번호 재설정을 이용해 주세요.");
};

$("#resetPassword").onclick=async()=>{
  const email=$("#loginForm").elements.email.value.trim();
  if(!email){
    $("#authMessage").textContent="로그인 이메일을 먼저 입력해 주세요.";
    return;
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    $("#authMessage").textContent="이메일 형식을 확인해 주세요.";
    return;
  }
  await action(()=>sendPasswordResetEmail(auth,email,{url:"https://ncc365.com/password-reset.html"}),"비밀번호 재설정 메일을 보내지 못했습니다.","입력한 이메일로 NCC 비밀번호 재설정 메일을 보냈습니다.");
};

$("#findEmailToggle").onclick=()=>{
  const area=$("#findEmailArea");
  area.hidden=!area.hidden;
  $("#findEmailToggle").setAttribute("aria-expanded",String(!area.hidden));
  if(!area.hidden)$("#findEmailName").focus();
};

$("#findEmailForm").onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  const data=Object.fromEntries(new FormData(form));
  const target=$("#findEmailMessage");
  target.textContent="본인정보를 확인하고 있습니다.";
  try{
    const response=await fetch("/api/account/recover-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:data.name.trim(),phone:data.phone})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.message||"가입정보를 확인하지 못했습니다.");
    target.textContent=body.found?`가입 이메일: ${body.maskedEmail}`:"일치하는 가입정보를 확인하지 못했습니다. 관리자 확인 요청을 이용해 주세요.";
    if(body.found)form.reset();
  }catch(error){
    console.error(error);
    target.textContent=error.message||"잠시 후 다시 시도해 주세요.";
  }
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

function memberSince(value){
  if(!value)return"NCC MEMBER";
  let date=null;
  if(typeof value?.toDate==="function")date=value.toDate();
  else if(value instanceof Date)date=value;
  else if(typeof value==="string"||typeof value==="number")date=new Date(value);
  if(!date||Number.isNaN(date.getTime()))return"NCC MEMBER";
  return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,"0")}`;
}

async function loadMember(user){
  try{
    let snap=await getDocs(query(collection(db,"members"),where("authUid","==",user.uid),limit(1)));
    if(snap.empty){
      snap=await getDocs(query(collection(db,"members"),where("email","==",user.email),limit(1)));
    }
    if(snap.empty){
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML='<div class="empty-state"><h2>연결할 NCC 회원정보가 없습니다.</h2><p>회원가입 때 등록한 이메일과 현재 인증한 이메일이 같은지 확인해 주세요.</p><button id="unmatchedLogout" class="text-button logout-button" type="button">다른 계정으로 로그인</button></div>';
      $("#unmatchedLogout").onclick=()=>signOut(auth);
      return;
    }
    const member={id:snap.docs[0].id,...snap.docs[0].data()};
    const accountStatus=member.status||"active";
    if(["paused","blocked","withdrawal_pending","withdrawn"].includes(accountStatus)){
      const statusLabel={paused:"일시 정지",blocked:"블랙리스트 차단",withdrawal_pending:"탈퇴 처리 중",withdrawn:"탈퇴 완료"}[accountStatus];
      sessionStorage.removeItem("nccMemberProfile");
      $("#memberArea").hidden=false;
      $("#memberArea").innerHTML=`<div class="empty-state"><h2>현재 ${statusLabel} 회원계정입니다.</h2><p>${accountStatus==="withdrawn"?"최종 탈퇴 처리된 계정입니다. 새 회원가입을 이용해 주세요.":"본사 관리자에게 회원상태 확인을 요청해 주세요."}</p><button id="restrictedLogout" class="text-button logout-button" type="button">다른 계정으로 로그인</button></div>`;
      $("#restrictedLogout").onclick=()=>signOut(auth);
      return;
    }
    if(member.mustChangePassword===true){
      forcedPasswordMemberId=member.id;
      $("#forcedPasswordArea").hidden=false;
      return;
    }
    const role=member.memberType||"consumer";
    if(ROLE_ROUTES[role]){
      location.replace(ROLE_ROUTES[role]);
      return;
    }
    let cardEnglish={};
    try{
      const profileSnapshot=await getDoc(doc(db,"memberProfiles",member.id));
      if(profileSnapshot.exists())cardEnglish=profileSnapshot.data()?.basic||{};
    }catch(error){
      console.warn("Optional card English profile could not be loaded.",error);
    }
    const cardMember={...member,cardNameEn:cardEnglish.cardNameEn||member.cardNameEn||"",cardRegionEn:cardEnglish.cardRegionEn||member.cardRegionEn||""};
    sessionStorage.setItem("nccMemberProfile",JSON.stringify({id:member.id,name:member.name||"",phone:member.phone||"",region:member.region||"",email:member.email||"",memberNumber:member.memberNumber||"",memberType:role,cardNameEn:cardMember.cardNameEn,cardRegionEn:cardMember.cardRegionEn}));
    const cardName=formatCardholderName(cardMember);
    const cardNameElement=$("#memberName");
    cardNameElement.textContent=cardName;
    cardNameElement.classList.toggle("is-long",cardName.length>20);
    cardNameElement.classList.toggle("is-very-long",cardName.length>32);
    cardNameElement.title=cardName;
    $("#memberNumber").textContent=member.memberNumber||"NUMBER PENDING";
    const verificationLink=$("#memberVerificationLink");
    if(verificationLink&&member.memberNumber){
      const verificationUrl=`${location.origin}/certificate-verify.html?id=${encodeURIComponent(member.memberNumber)}`;
      verificationLink.href=verificationUrl;
      const qrTarget=$("#memberQr");
      if(qrTarget&&typeof window.qrcode==="function"){
        const qr=window.qrcode(0,"M");
        qr.addData(verificationUrl);
        qr.make();
        qrTarget.innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true});
      }
    }
    $("#memberRegion").textContent=formatCardRegion(cardMember);
    $("#memberType").textContent=formatCardMemberType(role);
    $("#memberContact").textContent=`${member.phone||"연락처 미등록"} · ${member.email}`;
    const since=$("#memberSince");
    if(since)since.textContent=memberSince(member.joinDate||member.createdAt);
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

$("#forcedPasswordForm").onsubmit=async event=>{
  event.preventDefault();
  const data=Object.fromEntries(new FormData(event.currentTarget));
  const message=$("#forcedPasswordMessage");
  if(data.password.length<8){message.textContent="새 비밀번호는 8자 이상 입력해 주세요.";return}
  if(data.password!==data.confirm){message.textContent="새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";return}
  message.textContent="비밀번호를 변경하고 있습니다.";
  try{
    await updatePassword(currentUser,data.password);
    await updateDoc(doc(db,"members",forcedPasswordMemberId),{mustChangePassword:false,temporaryPasswordChangedAt:serverTimestamp(),updatedAt:serverTimestamp()});
    event.currentTarget.reset();
    message.textContent="비밀번호 변경을 완료했습니다.";
    location.reload();
  }catch(error){
    console.error(error);
    message.textContent="비밀번호를 변경하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.";
  }
};
