const navItems=[["HOME","index.html","home","nav-home"],["혜택센터","benefits.html","benefits","nav-priority"],["공동구매","groupbuy.html","groupbuy","nav-priority"],["소비자채널","consumer-channel.html","channel","nav-priority"],["전국소비자센터","centers.html","centers","nav-secondary nav-secondary-start"],["파트너센터","partner-center.html","partners","nav-secondary"]];
const current=document.body.dataset.page||"";
const header=`<a class="skip-link" href="#mainContent">본문 바로가기</a><header class="platform-header"><div class="platform-header-inner"><a class="platform-logo" href="index.html"><img src="images/NCC_HEADER.png?v=20260821-1" alt="전국소비자클럽 공식 로고"></a><nav class="platform-nav" id="platformNav">${navItems.map(([label,url,key,groupClass])=>`<a class="${[current===key?"active":"",groupClass].filter(Boolean).join(" ")}" href="${url}">${label}</a>`).join("")}<a class="wallet-link ${current==="wallet"?"active":""}" href="wallet.html">NCC 월렛</a><a class="join-link" href="join.html">회원가입</a></nav><button class="platform-menu" id="platformMenu" aria-expanded="false" aria-label="전체 메뉴 열기">☰</button></div></header>`;
const footer=`<footer class="platform-footer"><div class="footer-grid"><div class="footer-brand"><img src="images/NCC_HEADER.png?v=20260821-1" alt="전국소비자클럽"><p>대한민국 소비자가 더 많은 혜택을 누리는 곳<br>NATIONAL CONSUMER CLUB</p></div><div class="footer-links"><a href="benefits.html">혜택센터</a><a href="partner-center.html">파트너센터</a><a href="centers.html">전국소비자센터</a><a href="certificate-verify.html">인증서 진위확인</a><a href="admin.html">관리자</a></div></div></footer>`;
document.body.insertAdjacentHTML("afterbegin",header);document.body.insertAdjacentHTML("beforeend",footer);const menu=document.querySelector("#platformMenu"),nav=document.querySelector("#platformNav");menu?.addEventListener("click",()=>{const open=nav.classList.toggle("open");menu.setAttribute("aria-expanded",String(open));menu.textContent=open?"×":"☰"});nav?.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>nav.classList.remove("open")));

// REF-NCC-NAV-AUTH-STATE-02
const joinLink=nav?.querySelector(".join-link");
let shellAuth=null;
let shellSignOut=null;

function updateMemberNav(user){
  if(!joinLink)return;
  const signedIn=Boolean(user);
  joinLink.removeAttribute("aria-busy");
  joinLink.dataset.authState=signedIn?"signed-in":"signed-out";
  joinLink.classList.toggle("is-logout",signedIn);
  joinLink.textContent=signedIn?"로그아웃":"회원가입";
  joinLink.href=signedIn?"#logout":"join.html";
  joinLink.setAttribute("aria-label",signedIn?"NCC 월렛 로그아웃":"NCC 회원가입");
}

joinLink?.addEventListener("click",async event=>{
  if(joinLink.dataset.authState!=="signed-in"||!shellAuth||!shellSignOut)return;
  event.preventDefault();
  if(joinLink.getAttribute("aria-busy")==="true")return;
  joinLink.setAttribute("aria-busy","true");
  joinLink.textContent="로그아웃 중";
  try{
    await shellSignOut(shellAuth);
    location.replace("wallet.html");
  }catch(error){
    console.error(error);
    joinLink.removeAttribute("aria-busy");
    joinLink.textContent="로그아웃";
  }
});

async function initializeMemberNav(){
  if(!joinLink)return;
  try{
    const [{firebaseConfig},{initializeApp,getApps},{getAuth,onAuthStateChanged,signOut}]=await Promise.all([
      import("./platform-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js")
    ]);
    const app=getApps()[0]||initializeApp(firebaseConfig);
    shellAuth=getAuth(app);
    shellSignOut=signOut;
    onAuthStateChanged(shellAuth,user=>updateMemberNav(user));
  }catch(error){
    console.error("NCC 회원 메뉴 상태를 확인하지 못했습니다.",error);
    updateMemberNav(null);
  }
}

initializeMemberNav();
if(current==="wallet"){const card=document.querySelector(".wallet-services .platform-card:first-child");if(card){card.setAttribute("role","link");card.setAttribute("tabindex","0");card.style.cursor="pointer";const title=card.querySelector("h3"),note=card.querySelector("small");if(title)title.textContent="내 정보·배송지";if(note)note.textContent="맞춤정보와 공동구매 기본 배송지를 직접 관리합니다.";card.insertAdjacentHTML("beforeend",'<span class="arrow">정보 관리 →</span>');const openProfile=()=>location.href="profile.html";card.addEventListener("click",openProfile);card.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openProfile()}})}addEventListener("load",()=>import("./wallet-activity.js").catch(console.error),{once:true})}
if(["/admin","/admin.html"].includes(location.pathname.replace(/\/$/,""))){const grid=document.querySelector(".card-grid");if(grid&&!grid.querySelector('[href="admin-roles.html"]'))grid.insertAdjacentHTML("afterbegin",'<a class="platform-card" href="admin-roles.html"><span class="badge">ROLE ACCESS</span><h3>회원 역할·권한 관리</h3><p>소비자·센터장·센터 팀원·파트너회원 권한과 소속을 승인합니다.</p><span class="arrow">역할관리 열기 →</span></a>')}
