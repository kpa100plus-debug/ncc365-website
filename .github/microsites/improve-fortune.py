"""Narrow, reproducible patch for the existing compiled fortune deployment.
This is a maintenance transform, not the missing React authoring source.
Run against the original archive from commit 849b45158e7448135b27054e3b00ef6f4f6efdae.
Only the fortune JS and its HTML asset reference are changed; tarot stays byte-identical.
"""
from pathlib import Path
import hashlib,json,zipfile
archive=Path('.github/assets/adsense-microsites-text.zip')
old_asset='daily-fortune-now.pages.dev/assets/index-d8fOMnWB.js'
with zipfile.ZipFile(archive) as z:
    entries=[(i,z.read(i.filename)) for i in z.infolist()]
s=next(b.decode() for i,b in entries if i.filename==old_asset)
def replace_once(old,new):
    global s
    assert s.count(old)==1, 'Unexpected deployment source; stop without overwriting'
    s=s.replace(old,new)
ideas={
 'money':[
 '결제 전에 이번 주 지출 목록을 한 번 살펴보세요. 오늘의 작은 실천은 쓰지 않는 구독 하나를 확인하는 것입니다. 점수는 수익 가능성을 뜻하지 않으며 투자 판단의 근거로 사용하지 마세요.',
 '사고 싶은 물건과 지금 필요한 물건을 따로 적어보세요. 하루 뒤에도 필요한지 돌아보면 충동적인 선택을 줄이는 데 도움이 됩니다. 행운 숫자를 복권이나 투자 선택에 사용하지 마세요.',
 '작은 절약 목표 하나를 정하고 달성 여부를 저녁에 돌아보세요. 무조건 아끼기보다 나에게 의미 있는 지출인지 생각해 보는 날로 삼아보세요. 금전적 성과를 예측하는 내용은 아닙니다.'
 ],
 'love':[
 '상대의 마음을 단정하기보다 오늘 어땠는지 먼저 물어보세요. 답을 재촉하지 않고 듣는 시간이 대화의 시작이 됩니다. 관계의 중요한 결정은 실제 대화와 서로의 의사를 기준으로 하세요.',
 '고마웠던 일을 구체적으로 한 가지 전해보세요. 혼자 시간을 보내고 있다면 나를 편안하게 하는 활동을 골라도 좋습니다. 운세 점수가 만남이나 재회를 보장하지는 않습니다.',
 '서운했던 마음은 비난 대신 내가 느낀 감정으로 표현해보세요. 상대와 내가 편한 연락 간격도 다를 수 있습니다. 서로의 경계와 거절을 존중하는 것이 오늘의 실천입니다.'
 ],
 'work':[
 '오늘 끝낼 일 하나를 먼저 정하고 필요한 자료를 모아보세요. 요청이 모호하면 마감과 완료 기준을 확인하는 짧은 질문이 도움이 됩니다. 결과 점수는 업무 성과나 사업 성공의 예측이 아닙니다.',
 '큰 과제를 20분 안에 시작할 수 있는 작은 단계로 나눠보세요. 협업 중이라면 현재 진행 상황과 막힌 지점을 공유해보세요. 계약과 사업 판단은 실제 조건을 확인한 뒤 결정하세요.',
 '새로운 일을 더하기 전에 진행 중인 일의 우선순위를 점검해보세요. 집중 시간을 짧게 확보하고 끝난 일은 기록으로 남겨보세요. 운세는 채용·승진·매출의 결과를 알려주지 않습니다.'
 ],
 'main':[
 '오늘은 익숙한 일상에서 바꾸고 싶은 작은 습관을 하나 골라보세요. 실천 뒤에 기분이 어땠는지 한 줄로 적으면 내일의 자신을 이해하는 힌트가 됩니다.',
 '해야 할 일과 쉬는 시간을 함께 적어보세요. 모든 계획을 채우기보다 지금 가능한 한 가지를 선택하고, 저녁에 스스로에게 해주고 싶은 말을 남겨보세요.',
 '주변에서 고마웠던 장면을 한 가지 떠올려보세요. 도움이 필요하다면 구체적으로 부탁하고, 여유가 있다면 작은 친절을 건네는 하루로 삼아보세요.'
 ]}
start=s.index('function ie(e,t,n=`main`)');end=s.index('async function ae(e)',start)
replace_once(s[start:end], 'function ie(e,t,n=`main`){let r=w(`${e}-${t}-${n}`),a='+json.dumps(ideas,ensure_ascii=False,separators=(',',':'))+';let o=a[n]||a.main;return{score:68+r%30,line:ne[r%ne.length],number:r%45+1,color:re[r%re.length],detail:`${t}${n===`star`?``:`띠`} 오늘의 돌아보기: ${o[r%o.length]}`}}')
replace_once('[n,r]=(0,b.useState)(`용`),[i,a]=(0,b.useState)(`천칭자리`)', '[n,r]=(0,b.useState)(()=>{let e=new URLSearchParams(location.search).get(`zodiac`);return ee.includes(e)?e:`용`}),[i,a]=(0,b.useState)(()=>{let e=new URLSearchParams(location.search).get(`star`);return C.includes(e)?e:`천칭자리`})')
replace_once('url:`${location.origin}${location.pathname}`','url:`${location.origin}${location.pathname}?${new URLSearchParams({zodiac:n,star:i})}`')
replace_once('function g(){let e=p();if(typeof navigator.share!=`function`||navigator.canShare&&!navigator.canShare(e))','function g(){let e=p(),t=!1;try{t=typeof navigator.share===`function`&&(!navigator.canShare||navigator.canShare(e))}catch{}if(!t)')
new_name='index-revenue-'+hashlib.sha256(s.encode()).hexdigest()[:12]+'.js'
new_asset=old_asset.rsplit('/',1)[0]+'/'+new_name
out=archive.with_suffix('.tmp.zip')
changed=[]
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for info,data in entries:
        name=info.filename
        if name==old_asset: name=new_asset;data=s.encode();changed.append(name)
        elif name.startswith('daily-fortune-now.pages.dev/') and name.endswith('.html') and b'index-d8fOMnWB.js' in data:
            data=data.replace(b'index-d8fOMnWB.js',new_name.encode());changed.append(name)
        info.filename=name
        z.writestr(info,data)
with zipfile.ZipFile(out) as z:
    for info,data in entries:
        if info.filename.startswith('arcana-day.pages.dev/'): assert z.read(info.filename)==data
out.replace(archive)
print(json.dumps({'changed':changed,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
