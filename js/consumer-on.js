const canonicalBase="https://ncc365.com/consumer-on.html";
const toast=document.querySelector("#shareToast");
let toastTimer;

function shareUrl(target=""){
  if(!target)return canonicalBase;
  return `${canonicalBase}${target.startsWith("#")?target:`#${target}`}`;
}

function showToast(message){
  if(!toast)return;
  window.clearTimeout(toastTimer);
  toast.textContent=message;
  toast.classList.add("show");
  toastTimer=window.setTimeout(()=>toast.classList.remove("show"),2400);
}

async function copyText(value){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value);
    return;
  }
  const input=document.createElement("textarea");
  input.value=value;
  input.setAttribute("readonly","");
  input.style.position="fixed";
  input.style.opacity="0";
  document.body.append(input);
  input.select();
  const copied=document.execCommand("copy");
  input.remove();
  if(!copied)throw new Error("COPY_FAILED");
}

document.querySelectorAll("[data-copy-target]").forEach((button)=>{
  button.addEventListener("click",async()=>{
    try{
      await copyText(shareUrl(button.dataset.copyTarget));
      showToast("링크를 복사했습니다. 원하는 곳에 붙여넣으세요.");
    }catch{
      showToast("주소창의 링크를 직접 복사해 주세요.");
    }
  });
});

document.querySelectorAll("[data-share-target],[data-share-page]").forEach((button)=>{
  button.addEventListener("click",async()=>{
    const url=shareUrl(button.dataset.shareTarget);
    const title=button.dataset.shareTitle||"소비자ON | 생활에 바로 쓰는 소비자 주간지";
    const shareData={title,text:"소비생활에 바로 쓰는 정보와 확인표를 소비자ON에서 확인하세요.",url};
    if(navigator.share){
      try{
        await navigator.share(shareData);
        showToast("공유할 앱을 선택했습니다.");
        return;
      }catch(error){
        if(error?.name==="AbortError")return;
      }
    }
    try{
      await copyText(url);
      showToast("공유 링크를 복사했습니다. 문자·카카오톡·SNS에 붙여넣으세요.");
    }catch{
      showToast("주소창의 링크를 직접 복사해 주세요.");
    }
  });
});
