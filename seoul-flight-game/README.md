# Seoul Air Tour Viewer

## 실행

```bash
python3 -m http.server 5174 --bind 127.0.0.1 --directory "/Users/minwokim/Documents/New project/seoul-flight-game"
```

브라우저: `http://127.0.0.1:5174`

## 배포

- 바로 보기: `https://minwoo19930301.github.io/seoul-flight-game/`
- 배포 저장소: `https://github.com/minwoo19930301/seoul-flight-game`
- 배포 URL: `https://minwoo19930301.github.io/seoul-flight-game/`

## 구성

- 실제 서울 도로/하천/주행 경로/건물 풋프린트 데이터 기반 미니맵 + 지면 텍스처
- 실제 OSM 래스터 타일 기반 바닥/미니맵
- 랜드마크 순서 안내: `63빌딩 -> 경복궁 -> N서울타워 -> COEX -> 롯데월드타워`
- 1인칭 조종석 오버레이
- 마우스 시점 조종 + 키보드 보조 조작
- 지면/건물 충돌 없이 서울 상공을 천천히 둘러보는 비행 뷰어

## 조작

- 화면 클릭: 마우스 시점/방향 조종
- `W/S`: 느리게 상승/하강
- `A/D`: 좌우 기울기
- `Q/E`: 보조 러더
- `Shift`: 가속
- `Space`: 수평 복귀
- `R`: 처음 위치

## 데이터

- `assets/seoul-scene-data.json`: 서울 실제 도로/하천/주행 경로/건물 데이터
- `assets/seoul-map-data.json`: 기본 서울 벡터 맵 원본
- `assets/seoul-raster-map.png`: 서울 실제 OSM 래스터 베이스맵
- `vendor/three.module.js`, `vendor/three.core.js`: Three.js 런타임

실제 데이터 출처:

- 도로/하천/건물: OpenStreetMap / Overpass
- 경로: OSRM routing

래스터 베이스맵 재생성:

- `python3 scripts/build-osm-raster-map.py`
