# Seoul Flight Game

## 실행

```bash
python3 -m http.server 5174 --bind 127.0.0.1 --directory "/Users/minwokim/Documents/New project/seoul-flight-game"
```

브라우저: `http://127.0.0.1:5174`

## 배포

- GitHub Pages 워크플로: `.github/workflows/deploy-seoul-flight.yml`
- 예상 URL: `https://minwoo19930301.github.io/walkietalkie-app/`

## 구성

- 실제 서울 도로/하천/주행 경로/건물 풋프린트 데이터 기반 미니맵 + 지면 텍스처
- 실제 OSM 래스터 타일 기반 바닥/미니맵
- 실제 경로를 따라 뜨는 3D 내비게이션 라인
- 체크포인트: `63빌딩 -> 경복궁 -> N서울타워 -> COEX -> 롯데월드타워`
- 1인칭 조종석 오버레이
- 마우스 시점 조종 + 키보드 보조 조작

## 조작

- 화면 클릭: 마우스 시점/방향 조종
- `W/S`: 보조 기수 올림/내림
- `A/D`: 보조 뱅크
- `Q/E`: 보조 러더
- `Shift`: 부스트
- `Space`: 수평 복귀
- `R`: 재이륙

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
