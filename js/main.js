const menuButton=document.getElementById("menuButton");
const mainNav=document.getElementById("mainNav");
if(menuButton&&mainNav){menuButton.addEventListener("click",()=>{const open=mainNav.classList.toggle("open");menuButton.setAttribute("aria-expanded",String(open));menuButton.textContent=open?"×":"☰"});mainNav.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{mainNav.classList.remove("open");menuButton.setAttribute("aria-expanded","false");menuButton.textContent="☰"}))}
