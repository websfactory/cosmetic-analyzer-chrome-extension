# Cosmetic Analyzer Chrome Extension

올리브영 화장품 성분을 분석하고 정보를 제공하는 크롬 확장 프로그램입니다.

## 주요 기능

-   올리브영 제품 페이지에서 성분 분석
-   제품 정보 수집 및 엑셀 내보내기
-   EWG 등급 확인
-   성분별 상세 정보 제공
-   AI 기반 성분 분석 문의

## 설치 방법

1. 이 저장소를 클론합니다:
   git clone https://github.com/websfactory/cosmetic-analyzer-chrome-extension.git

2. [SheetJS](https://github.com/SheetJS/sheetjs) 라이브러리를 다운로드하여 `chrome_ext` 폴더에 `xlsx.full.min.js`로 저장합니다:

    - https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js

3. Chrome 브라우저에서 `chrome://extensions`로 이동합니다.
4. 우측 상단의 "개발자 모드"를 활성화합니다.
5. "압축해제된 확장 프로그램을 로드합니다" 버튼을 클릭합니다.
6. 클론한 디렉토리의 `chrome_ext` 폴더를 선택합니다.

## 프로젝트 구조

cosmetic-analyzer-chrome-extension/
├── chrome_ext/
│ ├── background.js
│ ├── content.js
│ ├── manifest.json
│ ├── styles.css
│ └── xlsx.full.min.js
├── .gitignore
├── LICENSE
├── package.json
└── README.md

## 개발 환경

-   Chrome Extension Manifest V3
-   JavaScript
-   HTML/CSS

## 라이선스

이 프로젝트는 MIT 라이선스를 따릅니다.
