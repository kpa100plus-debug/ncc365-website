import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,verifyPasswordResetCode,confirmPasswordReset,sendPasswordResetEmail}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app);
const $=selector=>document.querySelector(selector);
const code=new URLSearchParams(location.search).get("oobCode");
const resetUrl="https://ncc365.com/password-reset.html";
auth.languageCode="ko";
let valid=false;

async function start(){
  if(!code){
    $("#resetGuide").textContent="가입 이메일을 입력하면 비밀번호 재설정 메일을 보내드립니다.";
    $("#requestForm").hidden=false;
    $("#loginLink").hidden=false;
    return;
  }

  try{
    await verifyPasswordResetCode(auth,code);
    valid=true;
    $("#resetGuide").textContent="본인만 아는 새 비밀번호를 입력해 주세요.";
    $("#resetForm").hidden=false;
  }catch{
    $("#resetGuide").textContent="재설정 링크가 만료되었거나 이미 사용되었습니다. 아래에서 새 링크를 요청해 주세요.";
    $("#requestForm").hidden=false;
    $("#loginLink").hidden=false;
  }
}

$("#requestForm").onsubmit=async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector("button");
  const email=$("#resetEmail").value.trim();
  const message=$("#resetMessage");
  button.disabled=true;
  message.textContent="재설정 메일을 보내고 있습니다.";

  try{
    await sendPasswordResetEmail(auth,email,{url:resetUrl});
    $("#resetGuide").textContent="입력한 이메일로 재설정 링크를 보냈습니다.";
    message.textContent="메일함에서 ‘NCC 회원 비밀번호 재설정’ 메일을 열어 링크를 눌러주세요.";
  }catch(error){
    console.error(error);
    message.textContent=String(error?.code||"").includes("invalid-email")
      ?"이메일 주소 형식을 확인해 주세요."
      :"재설정 메일을 보내지 못했습니다. 가입 이메일을 확인한 뒤 다시 시도해 주세요.";
  }finally{
    button.disabled=false;
  }
};

$("#resetForm").onsubmit=async event=>{
  event.preventDefault();
  if(!valid)return;

  const data=Object.fromEntries(new FormData(event.currentTarget));
  const message=$("#resetMessage");
  if(data.password.length<8){
    message.textContent="새 비밀번호는 8자 이상 입력해 주세요.";
    return;
  }
  if(data.password!==data.confirm){
    message.textContent="새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";
    return;
  }

  message.textContent="비밀번호를 변경하고 있습니다.";
  try{
    await confirmPasswordReset(auth,code,data.password);
    event.currentTarget.hidden=true;
    $("#resetGuide").textContent="비밀번호 변경 완료";
    message.textContent="새 비밀번호로 NCC 회원 로그인을 이용할 수 있습니다.";
    $("#loginLink").hidden=false;
  }catch(error){
    console.error(error);
    message.textContent="비밀번호를 변경하지 못했습니다. 재설정 링크를 다시 요청해 주세요.";
  }
};

start();
