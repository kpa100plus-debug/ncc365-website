# NCC 테스트 결제 시스템 운영 기준

참조코드: `REF-NCC-PAYMENT-TEST-11`

NCC 전국소비자클럽은 ㈜ISEA GROUP이 소유·운영·관리하는 소비자 혜택 플랫폼입니다.

## 현재 범위

- 실제 카드승인, 계좌이체, 금전이동이 없는 테스트 결제만 처리한다.
- 회원은 본인 Firebase 로그인 토큰과 본인 공동구매 주문으로만 테스트 결제를 준비할 수 있다.
- 서버가 Firestore의 주문확정 상태와 주문금액을 다시 조회하므로 브라우저가 보낸 금액을 신뢰하지 않는다.
- 결제승인에는 중복결제 방지키를 사용하며 동일 주문은 한 번만 결제완료 상태가 된다.
- 관리자는 테스트 결제 준비 취소, 부분환불, 전액환불을 처리할 수 있다.
- 운영 결제와 혼동되지 않도록 모든 화면과 데이터에 `TEST` 및 `test_mode=1`을 표시한다.

## Cloudflare Pages 필수 연결

GitHub Actions의 `NCC Test Payment Provision` 워크플로가 회사가 통제하는 Cloudflare 계정에 다음 리소스를 자동으로 연결한다.

1. D1 데이터베이스 `ncc-test-payments`를 생성한다.
2. `migrations/0001_ncc_test_payments.sql`을 D1에 적용한다.
3. Pages 프로젝트 `ncc365-website`의 Production과 Preview에 D1 바인딩을 추가한다.
4. 바인딩 변수명은 반드시 `NCC_PAYMENTS`로 설정한다.
5. 다음 Pages 환경변수를 Production과 Preview에 설정한다.

   - `PAYMENT_MODE=test`
   - `FIREBASE_API_KEY`: Firebase `ncc-member` 웹 API 키
   - `FIREBASE_PROJECT_ID=ncc-member`
   - `ADMIN_EMAIL`: 현재 Firebase 결제관리자 이메일

6. 설정 후 Pages를 재배포하고 `/api/payments/config` 응답의 `enabled`가 `true`인지 확인한다.

워크플로는 `main`의 결제 Function·마이그레이션·자동화 파일이 변경될 때 실행되며, 수동 재실행도 가능하다. GitHub Actions 저장소 Secret `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`는 소스와 작업 로그에 출력하지 않는다.

## 보안·운영 원칙

- API 키, 관리자 비밀번호, PG 비밀키를 GitHub 소스나 채팅에 기록하지 않는다.
- D1에는 카드번호, 계좌번호, 비밀번호, 인증번호를 저장하지 않는다.
- 테스트 결제 데이터도 회원 이메일과 주문정보가 포함되므로 ㈜ISEA GROUP의 접근통제·보관·파기 기준을 적용한다.
- 테스트 완료 후 운영 전환 시 별도의 실결제 Worker와 운영 D1을 사용하고 테스트 데이터베이스를 재사용하지 않는다.
- 실제 PG 연동 전 이용약관, 개인정보처리방침, 결제·취소·환불정책과 사업자 표시정보를 실제 법인등록정보에 맞춰 검수한다.

© 2026 ISEA GROUP. All Rights Reserved.
