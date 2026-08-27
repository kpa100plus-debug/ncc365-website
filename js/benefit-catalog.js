const baseSteps=["회원 로그인 및 신청조건 확인","희망 지역·일정 입력","온라인 신청 접수","선정 결과와 이용방법 안내"];
const make=(id,tier,category,title,lead,image,area="전국 및 지역별",condition="회원 신청 접수",points=[])=>({id,tier,category,title,lead,image,area,condition,status:"신청 접수",target:"NCC 소비자회원",types:["혜택 참여 신청","모집 알림 신청"],points:points.length?points:[`${title} 참여 신청`,`회원별 신청내역 확인`,`선정 후 이용방법 개별 안내`],steps:baseSteps});

export const benefitCatalog=[
  make("first-health","first","HEALTH · 건강관리","건강검진·생활관리 회원 혜택","회원과 가족의 건강상담, 검진 및 생활관리 프로그램을 한곳에서 신청합니다.","images/card-benefit-health.webp","전국 및 지역별","기관별 일정 안내"),
  make("first-resort","first","TRAVEL · 숙박","프리미엄 리조트·호텔 프로그램","휴식이 필요한 회원을 위한 호텔·리조트 숙박 프로그램 참여 신청을 받습니다.","images/NCC_consumer.jpg","전국 주요 지역","일정별 선정 안내"),
  make("first-culture","first","CULTURE · 초청","문화공연·행사 초청","공연, 전시, 박람회와 지역행사 초청 정보를 확인하고 참여를 신청합니다.","images/card-channel-video.webp","수도권 및 전국","행사별 좌석 안내"),
  make("first-medical","first","WELLNESS · 상담","전문 웰니스 상담 프로그램","건강한 생활습관을 위한 분야별 전문상담과 맞춤 안내 프로그램입니다.","images/card-benefit-health.webp","전국 및 온라인","상담 일정 개별 안내"),
  make("first-travel","first","TRAVEL · 여행","국내 힐링여행 특별 프로그램","자연·문화·휴식을 함께 즐기는 국내 힐링여행 참여 프로그램입니다.","images/hero-benefits-2026.webp","국내 주요 여행지","회차별 선정 안내"),
  make("first-family","first","FAMILY · 가족","가족 문화·여가 프로그램","가족이 함께 참여할 수 있는 문화, 여가 및 주말 프로그램을 안내합니다.","images/NCC_consumer(1).jpg","전국 및 지역별","가족 단위 신청"),
  make("first-education","first","EDUCATION · 배움","중장년 평생교육 특별과정","디지털 활용, 재취업, 생활교양 등 중장년 맞춤 교육과정 참여 신청을 받습니다.","images/card-center-members.webp","온라인 및 지역 교육장","과정별 일정 안내"),
  make("first-senior","first","LIFE · 활력","중장년 활력생활 프로그램","운동, 취미, 교류 활동을 결합한 중장년 생활활력 프로그램입니다.","images/card-center-community.webp","전국 및 지역별","프로그램별 안내"),
  make("first-invitation","first","SPECIAL · 초청","NCC 회원 특별초청 행사","회원 대상 설명회, 문화행사와 특별 프로그램 소식을 우선 안내합니다.","images/card-channel-article.webp","행사별 지정 장소","초청 대상 개별 안내"),

  make("premium-skincare","premium","BEAUTY · 뷰티","프리미엄 스킨케어 경험단","스킨케어 제품을 직접 사용하고 솔직한 의견을 남기는 회원 프로그램입니다.","images/card-benefit-beauty.webp","전국 배송","상품별 선정 안내"),
  make("premium-healthfood","premium","FOOD · 건강식품","건강식품 경험 프로그램","생활에 필요한 건강식품 정보를 확인하고 회원 경험 프로그램에 신청합니다.","images/NCC_business.jpg","전국 배송","제품별 선정 안내"),
  make("premium-living","premium","LIVING · 생활용품","생활용품 경험단","주방, 청소, 수납 등 일상에 필요한 생활용품 경험단을 운영합니다.","images/card-channel-review.webp","전국 배송","1인 1상품 기준"),
  make("premium-home","premium","HOME · 홈케어","홈케어·생활가전 프로그램","생활가전과 홈케어 제품의 사용 편의성을 확인하는 회원 참여 프로그램입니다.","images/card-partner-experience.webp","전국 및 지역별","제품별 이용조건 안내"),
  make("premium-pet","premium","PET · 반려생활","반려동물 용품 경험단","반려가족을 위한 사료, 위생, 산책 및 생활용품 경험 프로그램입니다.","images/NCC_consumer.jpg","전국 배송","반려동물 정보 확인"),
  make("premium-food","premium","FOOD · 식품","지역특산물·간편식 경험단","지역특산물, 간편식과 생활식품을 만나보는 회원 경험 프로그램입니다.","images/NCC_local_store(1).jpg","전국 배송","상품별 선정 안내"),
  make("premium-mobility","premium","MOBILITY · 차량","자동차 생활용품 프로그램","세차, 차량관리와 안전용품 등 자동차 생활 관련 혜택을 안내합니다.","images/card-partner-store.webp","전국 및 지역별","차량정보 선택 입력"),
  make("premium-digital","premium","DIGITAL · 디지털","디지털기기·앱 활용 프로그램","생활에 유용한 디지털기기와 앱 서비스를 직접 활용하는 회원 프로그램입니다.","images/card-channel-video.webp","전국 및 온라인","서비스별 이용안내"),
  make("premium-fashion","premium","FASHION · 패션","패션·잡화 회원 경험단","의류, 신발, 가방과 생활잡화의 착용·사용 경험을 나누는 프로그램입니다.","images/card-channel-review.webp","전국 배송","상품별 옵션 안내"),

  make("daily-local","daily","LOCAL · 지역","우리 동네 회원 우대","가까운 지역의 음식점, 매장과 생활서비스 혜택을 찾아 신청합니다.","images/card-benefit-local.webp","전국 지역별","회원인증 후 이용"),
  make("daily-food","daily","FOOD · 외식","지역 카페·음식점 혜택","카페, 식당, 베이커리 등 지역 먹거리 혜택과 방문 정보를 안내합니다.","images/NCC_local_store.jpg","지역별 참여매장","매장별 조건 안내"),
  make("daily-beauty","daily","BEAUTY · 미용","미용·뷰티 서비스 혜택","헤어, 네일, 피부관리 등 생활밀착형 뷰티서비스 참여 신청을 받습니다.","images/card-partner-store.webp","지역별 참여매장","예약 일정 개별 안내"),
  make("daily-laundry","daily","LIFE · 세탁","세탁·수선 생활서비스","세탁, 의류수선과 신발관리 등 일상에 필요한 지역서비스를 안내합니다.","images/card-partner-store.webp","전국 지역별","매장별 이용조건"),
  make("daily-moving","daily","HOME · 주거","청소·이사·주거관리 혜택","청소, 정리수납, 이사와 주거관리 서비스의 회원 상담을 신청합니다.","images/NCC_business(1).jpg","전국 및 지역별","상담 후 조건 안내"),
  make("daily-learning","daily","EDUCATION · 지역강좌","지역 문화·취미 강좌","공예, 음악, 운동과 생활교양 등 가까운 지역강좌 정보를 안내합니다.","images/card-center-community.webp","전국 지역별","강좌별 일정 안내"),
  make("daily-market","daily","MARKET · 장보기","전통시장·지역상점 혜택","전통시장과 지역상점에서 만나는 생활상품 및 회원 혜택을 안내합니다.","images/card-center-market.webp","전국 지역별","매장별 혜택 안내"),
  make("daily-care","daily","CARE · 돌봄","가족 돌봄·생활지원 안내","가사, 돌봄과 생활지원 서비스가 필요한 회원의 상담 신청을 받습니다.","images/card-center-members.webp","전국 및 지역별","상담 후 이용안내"),
  make("daily-leisure","daily","LEISURE · 여가","운동·레저 회원 혜택","걷기, 피트니스, 골프와 지역 체육시설 등 생활운동 정보를 안내합니다.","images/hero-centers-2026.webp","전국 지역별","시설별 이용조건")
];

export const benefitMap=Object.fromEntries(benefitCatalog.map(item=>[item.id,item]));
