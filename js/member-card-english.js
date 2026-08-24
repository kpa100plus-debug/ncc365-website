const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const INITIALS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWELS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const FINALS = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lp", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "h"];

const SURNAME_ROMANIZATION = {
  "김": "KIM", "이": "LEE", "박": "PARK", "최": "CHOI", "정": "JUNG", "강": "KANG",
  "조": "CHO", "윤": "YOON", "장": "JANG", "임": "LIM", "한": "HAN", "오": "OH",
  "서": "SEO", "신": "SHIN", "권": "KWON", "황": "HWANG", "안": "AHN", "송": "SONG",
  "전": "JEON", "홍": "HONG", "유": "YOO", "고": "KO", "문": "MOON", "양": "YANG",
  "손": "SON", "배": "BAE", "백": "BAEK", "허": "HEO", "남": "NAM", "심": "SHIM",
  "노": "NOH", "하": "HA", "곽": "KWAK", "성": "SUNG", "차": "CHA", "주": "JOO",
  "우": "WOO", "구": "KOO", "민": "MIN", "진": "JIN", "지": "JI", "엄": "UM",
  "채": "CHAE", "원": "WON", "천": "CHUN", "방": "BANG", "공": "KONG", "현": "HYUN",
  "함": "HAM", "변": "BYUN", "염": "YEOM", "여": "YEO", "추": "CHOO", "도": "DO",
  "소": "SO", "석": "SEOK", "선": "SUN", "설": "SEOL", "마": "MA", "길": "GIL",
  "연": "YEON", "위": "WI", "표": "PYO", "명": "MYUNG", "기": "KI", "반": "BAN",
  "라": "RA", "왕": "WANG", "금": "KEUM", "옥": "OK", "육": "YOOK", "인": "IN",
  "맹": "MAENG", "제": "JE", "모": "MO",
  "남궁": "NAMGUNG", "황보": "HWANGBO", "제갈": "JEGAL", "선우": "SUNWOO",
  "사공": "SAGONG", "서문": "SEOMUN", "독고": "DOKGO", "동방": "DONGBANG"
};

const NAME_SYLLABLE_OVERRIDES = {
  "민": "MIN", "수": "SOO", "서": "SEO", "연": "YEON", "준": "JOON", "호": "HO",
  "지": "JI", "우": "WOO", "진": "JIN", "현": "HYUN", "윤": "YOON", "영": "YOUNG",
  "주": "JOO", "정": "JUNG", "성": "SUNG", "동": "DONG", "태": "TAE", "재": "JAE",
  "용": "YONG", "상": "SANG", "승": "SEUNG", "혜": "HYE", "경": "KYUNG", "희": "HEE",
  "은": "EUN", "예": "YE", "하": "HA", "유": "YU", "아": "A", "석": "SEOK"
};

const NAME_OVERRIDES = {
  "오테스트": "OH TEST",
  "테스트": "TEST",
  "테스트회원": "TEST MEMBER",
  "NCC 회원": "NCC MEMBER",
  "회원": "MEMBER"
};

const PROVINCES = [
  [["서울특별시", "서울"], "SEOUL"],
  [["부산광역시", "부산"], "BUSAN"],
  [["대구광역시", "대구"], "DAEGU"],
  [["인천광역시", "인천"], "INCHEON"],
  [["광주광역시", "광주"], "GWANGJU"],
  [["대전광역시", "대전"], "DAEJEON"],
  [["울산광역시", "울산"], "ULSAN"],
  [["세종특별자치시", "세종"], "SEJONG"],
  [["경기도", "경기"], "GYEONGGI"],
  [["강원특별자치도", "강원도", "강원"], "GANGWON"],
  [["충청북도", "충북"], "CHUNGBUK"],
  [["충청남도", "충남"], "CHUNGNAM"],
  [["전북특별자치도", "전라북도", "전북"], "JEONBUK"],
  [["전라남도", "전남"], "JEONNAM"],
  [["경상북도", "경북"], "GYEONGBUK"],
  [["경상남도", "경남"], "GYEONGNAM"],
  [["제주특별자치도", "제주도", "제주"], "JEJU"]
];

const PLACE_OVERRIDES = {
  "중": "JUNG-GU", "서": "SEO-GU", "동": "DONG-GU", "남": "NAM-GU", "북": "BUK-GU",
  "울진": "ULJIN", "강남": "GANGNAM", "강북": "GANGBUK", "서초": "SEOCHO", "송파": "SONGPA",
  "종로": "JONGNO", "용산": "YONGSAN", "마포": "MAPO", "영등포": "YEONGDEUNGPO",
  "해운대": "HAEUNDAE", "수영": "SUYEONG", "수원": "SUWON", "성남": "SEONGNAM",
  "고양": "GOYANG", "용인": "YONGIN", "부천": "BUCHEON", "안산": "ANSAN", "안양": "ANYANG",
  "평택": "PYEONGTAEK", "화성": "HWASEONG", "의정부": "UIJEONGBU", "포항": "POHANG",
  "경주": "GYEONGJU", "구미": "GUMI", "안동": "ANDONG", "김천": "GIMCHEON",
  "창원": "CHANGWON", "김해": "GIMHAE", "진주": "JINJU", "통영": "TONGYEONG",
  "전주": "JEONJU", "군산": "GUNSAN", "익산": "IKSAN", "목포": "MOKPO", "여수": "YEOSU",
  "순천": "SUNCHEON", "청주": "CHEONGJU", "충주": "CHUNGJU", "천안": "CHEONAN",
  "아산": "ASAN", "춘천": "CHUNCHEON", "원주": "WONJU", "강릉": "GANGNEUNG",
  "속초": "SOKCHO", "제주": "JEJU", "서귀포": "SEOGWIPO"
};

const MEMBER_TYPE_LABELS = {
  consumer: "CONSUMER MEMBER",
  center_manager: "CENTER MANAGER",
  center_staff: "CENTER STAFF",
  partner: "PARTNER MEMBER",
  corporate: "CORPORATE PARTNER",
  soleProprietor: "BUSINESS PARTNER",
  admin: "NCC ADMINISTRATOR"
};

const hasHangul = value => /[\uac00-\ud7a3]/.test(String(value || ""));

function cleanCardText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[•|/]+/g, " · ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function romanizeSyllable(character) {
  const code = character.charCodeAt(0);
  if (code < HANGUL_SYLLABLE_START || code > HANGUL_SYLLABLE_END) return character;
  const offset = code - HANGUL_SYLLABLE_START;
  const initial = Math.floor(offset / 588);
  const vowel = Math.floor((offset % 588) / 28);
  const final = offset % 28;
  return `${INITIALS[initial]}${VOWELS[vowel]}${FINALS[final]}`;
}

function romanizeHangulWord(value, separator = "") {
  return [...String(value || "")]
    .map(character => romanizeSyllable(character))
    .filter(Boolean)
    .join(separator)
    .toUpperCase();
}

function romanizeGivenName(value) {
  if (NAME_OVERRIDES[value]) return NAME_OVERRIDES[value];
  return [...String(value || "")]
    .map(character => NAME_SYLLABLE_OVERRIDES[character] || romanizeSyllable(character).toUpperCase())
    .filter(Boolean)
    .join("-");
}

function romanizeKoreanName(value) {
  const source = String(value || "").normalize("NFKC").trim();
  if (!source) return "NCC MEMBER";
  if (NAME_OVERRIDES[source]) return NAME_OVERRIDES[source];
  if (!hasHangul(source)) return cleanCardText(source);

  const compact = source.replace(/\s+/g, "");
  if (NAME_OVERRIDES[compact]) return NAME_OVERRIDES[compact];
  const compoundSurname = Object.keys(SURNAME_ROMANIZATION).find(key => key.length === 2 && compact.startsWith(key));
  const surname = compoundSurname || compact[0];
  const givenName = compact.slice(surname.length);
  const surnameEnglish = SURNAME_ROMANIZATION[surname] || romanizeHangulWord(surname);
  const givenEnglish = romanizeGivenName(givenName);
  return cleanCardText([surnameEnglish, givenEnglish].filter(Boolean).join(" "));
}

function preferredEnglishValue(record, keys) {
  for (const key of keys) {
    const value = String(record?.[key] || "").trim();
    if (value && !hasHangul(value)) return cleanCardText(value);
  }
  return "";
}

function findProvince(value) {
  for (const [aliases, english] of PROVINCES) {
    const alias = [...aliases].sort((a, b) => b.length - a.length).find(item => value.includes(item));
    if (alias) return { alias, english };
  }
  return null;
}

function romanizeLocality(value) {
  const compact = String(value || "")
    .replace(/[0-9].*$/, "")
    .replace(/(특별자치시|특별자치도|광역시|시|군|구|읍|면|동|리)$/u, "")
    .replace(/[^\p{L}\-]/gu, "")
    .trim();
  if (!compact) return "";
  if (PLACE_OVERRIDES[compact]) return PLACE_OVERRIDES[compact];
  if (!hasHangul(compact)) return cleanCardText(compact);
  return romanizeHangulWord(compact);
}

export function formatCardholderName(member = {}) {
  const preferred = preferredEnglishValue(member, ["cardNameEn", "nameEn", "englishName", "nameEnglish", "fullNameEn"]);
  return (preferred || romanizeKoreanName(member.name)).slice(0, 48);
}

export function formatCardRegion(member = {}) {
  const preferred = preferredEnglishValue(member, ["cardRegionEn", "regionEn", "englishRegion"]);
  if (preferred) return preferred.slice(0, 64);

  const source = String(member.region || "").normalize("NFKC").trim();
  if (!source) return "REGION NOT REGISTERED";
  if (!hasHangul(source)) return cleanCardText(source).slice(0, 64);

  const province = findProvince(source);
  const remaining = province ? source.replace(province.alias, " ") : source;
  const localityToken = remaining
    .replace(/[(),·/]/g, " ")
    .split(/\s+/)
    .map(token => token.trim())
    .find(token => token && !/^[0-9-]+$/.test(token));
  const locality = romanizeLocality(localityToken);
  const values = [locality, province?.english, "KR"].filter(Boolean);
  return [...new Set(values)].join(" · ").slice(0, 64);
}

export function formatCardMemberType(memberType = "consumer") {
  return MEMBER_TYPE_LABELS[memberType] || "NCC MEMBER";
}
