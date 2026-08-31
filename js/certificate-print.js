import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./platform-config.js";
const id=new URLSearchParams(location.search).get("id")||"";
const $=s=>document.querySelector(s);
const app=getApps()[0]||initializeApp(firebaseConfig),db=getFirestore(app);
if(!/^NCC-[A-Z0-9]+(?:-[A-Z0-9]+){2,6}$/.test(id)) { $("#name").textContent="유효한 인증번호가 아닙니다."; }
else { const snap=await getDoc(doc(db,"certificates",id)); if(!snap.exists()||snap.data().public!==true||snap.data().status!=="active"){ $("#name").textContent="정상 발급 인증서를 찾을 수 없습니다."; } else { const d=snap.data(); $("#title").textContent=d.title; $("#name").textContent=d.recipientName; $("#detail").textContent=[d.category,d.region,d.issuedAt&&`발급일 ${d.issuedAt}`].filter(Boolean).join(" · "); $("#number").textContent=d.certificateNumber; $("#issuer").textContent=d.issuer||"NCC 전국소비자클럽"; } }
