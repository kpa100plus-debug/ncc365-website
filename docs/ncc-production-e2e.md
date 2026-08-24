# NCC 운영 자동검사

이 자동검사는 공유 클라우드 브라우저 없이 GitHub Actions의 격리된 실행 환경에서만 실행합니다.

## 검사 범위

- 테스트회원D(`NCC-C-000016`) 로그인 및 회원 식별
- NCC 월렛과 마이페이지 접근
- 회원정보 임시 변경 후 원래 값으로 즉시 복구
- 탈퇴요청 접수 후 관리자가 자동 반려
- 계정변경 로그의 탈퇴 반려 기록 확인
- 새 로그인 세션으로 최종 `active` 상태 확인

계정 파기, 비밀번호 변경, 이메일 변경, 탈퇴 승인, 개인정보 파기 버튼 조작은 하지 않습니다.

## 필요한 GitHub Actions Secrets

저장 위치: 저장소 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

- `NCC_E2E_D_EMAIL`
- `NCC_E2E_D_PASSWORD`
- `NCC_E2E_ADMIN_EMAIL`
- `NCC_E2E_ADMIN_PASSWORD`

값은 채팅, 커밋, 실행 로그에 입력하지 않습니다. 자동검사 로그와 7일 보관 결과 파일에는 이메일, 연락처, 비밀번호를 기록하지 않습니다.

## 실행

저장소 `Actions` → `NCC Production E2E` → `Run workflow`에서 안전 확인용 회원번호 `NCC-C-000016`을 입력합니다. 다른 회원번호를 입력하면 작업이 실행되지 않습니다.

