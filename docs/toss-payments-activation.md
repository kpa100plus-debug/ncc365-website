# NCC 토스페이먼츠 활성화 인계서

참조코드: `REF-NCC-TOSS-PAYMENTS-PREBUILD-MASTER-20`

## 현재 안전 상태

- 기존 D1 결제·회원·주문 데이터는 유지한다.
- 기존 `payments.test_mode` 호환값은 보존하고, 토스 테스트·운영 구분은 새 공급자 기록의 `environment`를 기준으로 판정한다.
- 기본 배포값은 `PAYMENT_MODE=test`, `PAYMENT_PROVIDER=simulation`, `TOSS_MODE=disabled`다.
- 토스 키가 없거나 종류가 맞지 않으면 결제창이 열리지 않는다.
- 테스트키 활성화 중에도 테스트회원 D와 관리자만 결제창에 접근할 수 있다.
- 운영 결제는 운영키, `PAYMENT_MODE=live`, `TOSS_MODE=live`, 정확한 운영 확인문구가 모두 있어야 열린다.

## 계약 승인 후 한 번만 준비할 항목

1. 토스페이먼츠 개발자센터에서 결제위젯용 클라이언트 키(`*_gck_*`)와 시크릿 키(`*_gsk_*`)를 확인한다.
2. GitHub 저장소 Actions secrets에 테스트용 `TOSS_TEST_CLIENT_KEY`, `TOSS_TEST_SECRET_KEY`를 저장한다.
3. 운영 전환 시 운영용 `TOSS_LIVE_CLIENT_KEY`, `TOSS_LIVE_SECRET_KEY`를 별도로 저장한다.
4. 토스페이먼츠 웹훅에 `https://ncc365.com/api/payments/webhook/toss`를 등록하고 `PAYMENT_STATUS_CHANGED`를 선택한다.
5. GitHub Actions의 **NCC Toss Payments Activate**를 실행한다. 먼저 `test`를 선택해 테스트 결제를 확인한다.
6. 실제 운영 승인 후에만 `live`를 선택하고 확인문구 `NCC-TOSS-LIVE-CONFIRMED`를 입력한다.

활성화 워크플로는 키 적용 전에 D1 공급자 테이블을 멱등 방식으로 다시 확인하며, 누락 시 기존 데이터를 보존한 채 생성한다.

## 즉시 잠금

같은 워크플로에서 `disabled`를 선택하면 키를 삭제하지 않고도 결제창과 토스 호출이 즉시 비활성화된다. 저장된 키는 런타임 응답·로그·소스에 출력되지 않는다.

## 구현된 흐름

- 회원 본인 주문·확정상태·금액 서버 검증
- 토스 결제위젯 v2 렌더링
- 성공 URL의 `paymentKey`, `orderId`, `amount` 서버 재검증
- 토스 Confirm API 승인 및 중복방지키 적용
- 부분·전액 취소 API와 관리자 환불 사유
- 결제상태 웹훅 수신 후 토스 API 재조회
- 관리자 수동 상태 재동기화
- 영수증 링크와 회원 결제상태 표시
- 테스트키와 운영키 형식·환경 불일치 차단
- 모든 테스트 결제 허용 계정 제한(`NCC_E2E_D_EMAIL`과 관리자)
