<p align="center"><img src="icons/icon128.png" width="72" alt=""></p>

# Draft Log

**ChatGPT·Claude로 고쳐 쓴 자소서, 버전으로 남기세요.**

Draft Log는 chatgpt.com·claude.ai 옆에 붙는 크롬 확장 프로그램입니다.
평소처럼 채팅으로 자소서를 고치면서, 마음에 드는 답변을 **문항별 버전**으로 저장하고 무엇이 바뀌었는지 비교할 수 있어요.
API 키도 서버도 필요 없어서 무료 요금제 사용자도 바로 쓸 수 있습니다.

## 주요 기능

- **지원서 → 문항 → 버전**: 회사별 마감 D-day, 문항별 글자수 제한
- **글자수 3가지 기준**: 공백 포함 · 공백 제외 · 바이트(한글 2, 영문 1, 줄바꿈 2)
- **채팅 답변 저장**: 답변에 마우스를 올리면 `자소서에 저장`, 일부만 드래그해서 저장, 우클릭 메뉴 저장
  - 저장 전 내용 수정, 저장할 문항 선택, 출처(ChatGPT/Claude)와 대화 링크 기록
- **요청문 보내기**: 첨삭 · 글자수 맞추기 · 다듬기 · 직접 요청을 고르면 문항·제한·공고 메모·현재 답변이 담긴 요청문이 채팅 입력창에 들어감
- **버전 비교**: 어절 단위로 추가·삭제를 색으로 표시
- **최종본 표시, 예전 버전으로 이어 쓰기, 전체 검색, JSON 백업·복원**
- **PC 폴더 자동 저장**: 고른 폴더에 바뀔 때마다 `draftlog.json` 저장 + 최근 14일 날짜별 스냅샷

## 설치

### 개발자 모드로 설치

```bash
git clone https://github.com/jklee3409/draftlog.git
```

1. 크롬 주소창에 `chrome://extensions` 입력
2. 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 클론한 `draftlog` 폴더 선택 (`manifest.json`이 있는 폴더)
4. 툴바 퍼즐 아이콘에서 **Draft Log** 고정 → 누르면 사이드 패널이 열림
5. 이미 열어둔 ChatGPT·Claude 탭은 새로고침

엣지(`edge://extensions`)도 같은 방법으로 설치됩니다.

### 배포용 zip 만들기

```bash
npm run pack   # dist/draftlog-<버전>.zip
```

## 사용 흐름

1. 패널에서 **+ 지원서** → 회사·직무·마감일 → **+ 문항**으로 문항과 글자수 제한 입력
2. `작성` 탭에서 글 작성 → **버전 저장** (Ctrl/⌘+S)
3. `AI에게 묻기` 탭 → 요청 종류 선택 → **ChatGPT 입력창에 넣기** → 채팅에서 보내기
4. 답이 오면 답변 위 **자소서에 저장** → 새 버전으로 쌓임
5. `버전` 탭에서 두 버전을 체크해 **비교**, 마음에 드는 버전은 **최종본**(★)
6. 예전 버전이 더 나으면 **이 버전으로 이어 쓰기** → 작성 탭으로 가져와 고친 뒤 저장 (기존 버전은 그대로 남음)

## 개발

### 고치면서 바로 확인하기 (자동 새로고침)

```bash
npm install
npx playwright install chromium   # 처음 한 번
npm run dev                        # 확장을 설치한 Chromium이 열림
```

- 파일을 저장하면 알아서 반영돼요. `sidepanel/`만 바뀌면 패널만, 그 밖의 파일은 확장을 다시 불러오고 채팅 탭까지 새로고침합니다.
- 패널은 탭으로 열려요. 툴바의 Draft Log 아이콘을 누르면 사이드 패널로도 열립니다.
- 로그인 상태는 `.dev-profile/`에 남아 다음 실행에도 유지돼요. 처음 한 번만 ChatGPT·Claude에 로그인하세요.
- 다른 주소로 시작하려면 `npm run dev -- https://claude.ai/`
- 정식 크롬(137 이상)은 명령줄로 확장을 불러오는 기능을 막아서, 개발 모드는 Playwright의 Chromium으로 띄웁니다.

평소 쓰는 크롬에서 확인할 때는 zip 대신 클론한 폴더를 한 번만 **압축해제된 확장 프로그램으로 로드**해 두세요.
그 뒤로는 `git pull`(또는 `git checkout <브랜치>`) → `chrome://extensions`의 Draft Log 새로고침(↻) → 채팅 탭 새로고침이면 됩니다.

### 테스트

```bash
npm test            # 단위 테스트 (node:test) — 글자수, 비교, 요청문, 저장소
npm run test:e2e    # 확장을 설치한 Chromium + 가짜 chatgpt.com 페이지로 핵심 흐름 확인
```

### 구조

```
manifest.json          MV3 설정
background.js          쓰기 요청 직렬 처리, 우클릭 메뉴, 패널 열기
lib/store.js           저장소 연산 (순수 함수)
lib/text.js            글자수, 비교(diff), 요청문
lib/filesync.js        PC 폴더 자동 저장 (폴더 핸들 보관, 파일 읽기·쓰기, 스냅샷 정리)
sidepanel/             사이드 패널 화면
content/content.js     채팅 페이지의 저장 버튼·저장 카드·입력창 넣기 (shadow DOM)
scripts/               개발 모드(dev), 아이콘 생성(icons), 배포 zip(pack)
tests/                 단위 테스트, E2E 테스트
docs/                  기획·설계·화면 문서
```

자세한 내용은 [기획](docs/PLANNING.md) · [설계](docs/ARCHITECTURE.md) · [화면](docs/UI.md) 문서를 참고하세요.

## 알아둘 점

- 데이터는 **사용자 브라우저**에 저장되고 외부로 전송하지 않습니다. 확장을 삭제하면 브라우저 데이터도 지워지니 **PC 폴더 자동 저장**을 켜두세요.
  - 패널 오른쪽 위 `⋯` → **폴더 선택해서 켜기**. OneDrive·구글 드라이브 동기화 폴더를 고르면 클라우드에도 남습니다.
  - 확장을 다시 설치했거나 다른 PC에서는 같은 폴더를 고르면 **폴더 데이터 불러오기**로 복원됩니다.
  - 브라우저를 다시 켜면 폴더 접근을 한 번 더 허용해야 할 수 있어요(패널 상단의 **다시 허용**).
  - 폴더 구성: `draftlog.json`(최신본), `backups/draftlog-YYYYMMDD.json`(날짜별, 14개 유지), `backups/before-*.json`(충돌 해결 때 버려진 쪽)
- ChatGPT·Claude의 화면 구조가 바뀌면 답변 위 버튼이 안 뜰 수 있습니다. 이때도 드래그 저장과 우클릭 메뉴는 동작합니다.
  셀렉터는 `content/content.js`의 `MESSAGE_SELECTORS`, `COMPOSER_SELECTORS`에서 고칠 수 있습니다.
- 동작 대상: `chatgpt.com`, `chat.openai.com`, `claude.ai`
