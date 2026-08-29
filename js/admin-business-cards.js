import{initializeApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import{getAuth,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import{firebaseConfig}from"./platform-config.js";

const app=getApps()[0]||initializeApp(firebaseConfig);
const auth=getAuth(app);
const ADMIN_EMAIL="kpa100plus@gmail.com";
const MEMBER_NUMBER_PATTERN=/^NCC-C-[0-9]{6}$/;
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const form=$("#cardForm");
const message=$("#formMessage");

const roleEnglish={"센터장":"NCC CENTER DIRECTOR","운영팀장":"NCC OPERATIONS LEAD","회원지원팀장":"NCC MEMBER SUPPORT LEAD","지역협력매니저":"NCC COMMUNITY PARTNERSHIP MANAGER","센터 팀원":"NCC CENTER STAFF"};

function normalizeMemberNumber(value){return String(value||"").trim().toUpperCase().replace(/[–—−]/g,"-").replace(/\s+/g,"")}
function normalizeCenterCode(value){return String(value||"").trim().toUpperCase().replace(/\s+/g,"-")}
function setOutput(key,value){$$(`[data-output="${key}"]`).forEach(node=>node.textContent=value||"미입력")}
function renderQr(memberNumber){
  const url=`${location.origin}/certificate-verify.html?id=${encodeURIComponent(memberNumber)}`;
  const target=$("#cardQr");
  target.replaceChildren();
  if(typeof window.qrcode==="function"){
    const qr=window.qrcode(0,"M");qr.addData(url);qr.make();target.innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true});
  }else target.textContent="QR 생성 실패";
  const link=$("#verificationLink");link.href=url;link.textContent=`QR 연결 확인 · ${memberNumber}`;
}
function values(){const data=Object.fromEntries(new FormData(form));data.memberNumber=normalizeMemberNumber(data.memberNumber);data.centerCode=normalizeCenterCode(data.centerCode);return data}
function render(){
  const data=values();
  if(!form.reportValidity())return false;
  if(!MEMBER_NUMBER_PATTERN.test(data.memberNumber)){message.textContent="회원번호는 NCC-C-000001 형식의 실제 발급번호를 입력해 주세요.";form.elements.memberNumber.focus();return false}
  if(!data.centerCode||data.centerCode.length>100){message.textContent="센터코드는 현재 시스템에 저장된 100자 이하 코드를 입력해 주세요.";form.elements.centerCode.focus();return false}
  setOutput("name",data.name.trim());setOutput("centerRole",`${data.centerName.trim()} ${data.role}`);setOutput("roleEnglish",roleEnglish[data.role]||"NCC CENTER STAFF");setOutput("phone",data.phone.trim());setOutput("email",data.email.trim());setOutput("address",data.address.trim()||"주소 미등록");setOutput("centerCode",data.centerCode);setOutput("memberNumber",data.memberNumber);
  const preview=$("#previewSet");preview.classList.toggle("portrait",data.orientation==="portrait");preview.classList.toggle("landscape",data.orientation!=="portrait");
  renderQr(data.memberNumber);message.textContent="명함 시안을 갱신했습니다. 실제 회원번호와 센터코드인지 확인해 주세요.";return true;
}

form.addEventListener("submit",event=>{event.preventDefault();render()});
form.addEventListener("input",()=>{window.clearTimeout(form.renderTimer);form.renderTimer=window.setTimeout(()=>{if(form.checkValidity())render()},180)});
form.addEventListener("change",()=>{if(form.checkValidity())render()});
$("#logoutButton").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth,user=>{
  const gate=$("#authGate"),studio=$("#studioApp");
  if(!user){gate.innerHTML='<strong>관리자 로그인이 필요합니다.</strong><p><a href="wallet.html">NCC 월렛 로그인으로 이동</a></p>';return}
  if(user.email?.toLowerCase()!==ADMIN_EMAIL){gate.innerHTML="<strong>이 화면은 승인된 관리자만 이용할 수 있습니다.</strong>";return}
  gate.hidden=true;studio.hidden=false;render();
});
