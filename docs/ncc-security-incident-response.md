# REF-NCC-SECURITY-INCIDENT-RESPONSE-01

# NCC 보안사고 대응·복구 절차

운영 주체: ㈜ISEA GROUP
대상: 전국소비자클럽(NCC) `ncc365.com`, GitHub, Cloudflare Pages, Firebase

## 1. 감염·침해 의심 직후

1. 증거 보존을 위해 화면, 시각, 계정, IP, 변경내역을 기록한다.
2. GitHub Actions의 `Emergency Firestore Lockdown`을 수동 실행한다.
3. `LOCKDOWN`과 `NCC-PRODUCTION-CONFIRMED`를 정확히 입력한다.
4. Google/Firebase, GitHub, Cloudflare, 도메인 계정의 활성 세션을 종료한다.
5. 비밀번호, 패스키, API 토큰을 안전한 기기에서 교체한다.
6. 공격이 끝났다고 확인하기 전 실제 데이터 삭제·일괄복원을 실행하지 않는다.

## 2. 서비스 복구

1. Cloudflare Pages에서 침해 이전의 정상 프로덕션 배포본으로 롤백한다.
2. GitHub `main`의 변경 커밋과 Actions 실행기록을 확인한다.
3. Firestore는 PITR 또는 예약백업이 활성화된 경우 새 데이터베이스로 우선 복구한다.
4. 복구본의 회원 수, 인증서 수, 주요 신청·주문 기록을 원본 로그와 대조한다.
5. 검증 완료 후 `Emergency Firestore Lockdown`을 `RESTORE` 모드로 실행한다.
6. 회원 로그인·가입·관리자 조회·인증서 조회를 순서대로 검사한다.

## 3. 개인정보 유출 대응

1. 유출된 항목, 대상자 수, 발생·인지 시각과 원인을 확인한다.
2. 개인정보 보호책임자에게 즉시 보고한다.
3. 법정 신고·통지 대상인지 검토하고 필요한 경우 개인정보보호위원회 신고 및 이용자 통지를 진행한다.
4. 원인과 조치가 확정되기 전 추정 내용을 사실처럼 공지하지 않는다.

## 4. 정기 복구훈련

- 매월: GitHub·Cloudflare·Firebase 관리자와 2단계 인증 상태 확인
- 매월: 독립 코드 백업 생성 및 복원 가능 여부 확인
- 분기: Firestore 백업을 별도 데이터베이스에 복원하는 모의훈련
- 반기: 관리자 계정 탈취와 DB 오삭제를 가정한 전체 대응훈련
