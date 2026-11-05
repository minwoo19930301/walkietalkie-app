# 워키토키

[![워키토키](public/images/video-call.jpg)](https://meeting.ai-ing.org/)

[![OPEN APP](https://img.shields.io/badge/OPEN_APP-294a38?style=for-the-badge)](https://meeting.ai-ing.org/) [![SOURCE](https://img.shields.io/badge/SOURCE-444444?style=for-the-badge)](https://github.com/minwoo19930301/walkietalkie-app)


브라우저만으로 바로 들어와서 통화하는 WebRTC 기반 영상·음성 채팅 앱입니다.  
첫 화면에서 통화방을 만들거나 대기 중인 방에 참여할 수 있습니다. 초대 링크로 접속하면 해당 방으로 바로 연결됩니다.

## 링크

- GitHub 저장소: [https://github.com/minwoo19930301/walkietalkie-app](https://github.com/minwoo19930301/walkietalkie-app)
- Live 주소: [https://meeting.ai-ing.org/](https://meeting.ai-ing.org/)

## 현재 기능

- 첫 진입 시 공개 4인 `빠른 방` 자동 생성
- 랜덤 방 번호 예시: `482193`
- 비공개방: 비밀번호 숫자 4자리
- 최대 인원 선택: 4명 / 6명 / 8명
- 종료 후 대기실에서 `현재 대기 중인 방 목록` 확인
- 초대 모달에서 `방 번호 - 비밀번호` 형태 확인 + 초대 링크 전달(Web Share)
- 마이크/카메라/좌우 반전/종료 버튼이 있는 모바일 통화 화면
- 임시 채팅 말풍선: 전송 후 약 3초 표시
- 낙서 오버레이: 실시간 공유되고 3초 무입력 시 자동 삭제
- 연결이 불안정할 때 일반 사용자용 재시도 가이드 모달

## 구조

- 프런트엔드: 정적 HTML/CSS/JS
- 서버: Cloudflare Worker + Durable Object
- 미디어: WebRTC 브라우저 직접 전송(P2P Mesh), 직접 연결이 안 되면 Cloudflare TURN 중계
- 데이터 저장: Durable Object에 방 메타와 대기실 목록 최소 저장
- 별도 DB/KV/R2: 사용 안 함

## 비용

기본 운영은 Workers Free 범위에서 거의 0원에 가깝게 운영 가능합니다.

- 기존 ai-ing.org 도메인의 하위 주소라 추가 도메인 비용 없음
- 영상/음성은 서버 중계가 아니라 브라우저끼리 직접 전송
- LTE처럼 직접 연결이 안 되는 경우만 Cloudflare TURN 이 중계합니다. 1GB 당 $0.05, 매달 1,000GB 무료

## 다자간(4~8명) 주의점

서버가 바로 터지는 구조는 아니지만, 다자간은 클라이언트 부담이 커집니다.

- 4명: 대부분 기기에서 현실적으로 안정적
- 6명: 네트워크/기기 성능에 따라 품질 편차가 커짐
- 8명: 저사양 폰·약한 네트워크에서 끊김 가능성 큼

즉, 서버 비용보다 각 참여자 기기/네트워크 대역폭이 먼저 병목이 됩니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

```bash
npm run deploy
```

다른 네트워크끼리 연결하려면 Cloudflare 대시보드 Realtime → TURN Server 에서 키를 만들고 secret 두 개를 넣습니다. 없으면 STUN 만 씁니다.

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

## 점검

```bash
npm run check
```

## 사진 출처

랜딩 사진: [Anna Shvets / Pexels](https://www.pexels.com/photo/people-on-a-video-call-4226140/). [Pexels License](https://www.pexels.com/license/)에 따라 상업적 웹사이트 사용이 허용됩니다. 사진은 화상회의 상황을 보여주는 스톡 이미지이며 실제 서비스 화면은 아닙니다.
