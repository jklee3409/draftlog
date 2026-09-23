# Draft Log 설계

## 구성

Chrome Manifest V3 확장 프로그램. 서버 없음.

```
┌────────────── 브라우저 ──────────────────────────────────────────┐
│                                                                  │
│  chatgpt.com / claude.ai 탭              사이드 패널              │
│  ┌──────────────────────┐              ┌──────────────────────┐  │
│  │ content/content.js   │              │ sidepanel/panel.js   │  │
│  │ - 답변 저장 버튼     │              │ - 지원서·문항·버전 UI│  │
│  │ - 선택 영역 저장     │              │ - 요청문 만들기      │  │
│  │ - 입력창에 요청 넣기 │◀─ dl:insert ─│ - 비교·검색·백업     │  │
│  └──────────┬───────────┘              └──────────┬───────────┘  │
│             │ dl:op (쓰기)                        │ dl:op (쓰기) │
│             ▼                                     ▼              │
│        ┌──────────────────────────────────────────────────┐      │
│        │ background.js (service worker)                   │      │
│        │ - 쓰기 요청을 한 줄로 세워 lib/store.js로 처리   │      │
│        │ - 우클릭 메뉴, 패널 열기                          │      │
│        └──────────────────────┬───────────────────────────┘      │
│                               ▼                                  │
│                   chrome.storage.local { db, activeQ }           │
│                   (읽기는 각자 직접, 변경은 onChanged로 전파)       │
│                               │ 쓰기 1.5초 뒤 사본 저장           │
└───────────────────────────────┼──────────────────────────────────┘
                                ▼
                 사용자가 고른 PC 폴더 (File System Access API)
                 draftlog.json + backups/draftlog-YYYYMMDD.json
```

## 설계 결정

### 1. 쓰기는 백그라운드 한 곳에서만

`chrome.storage.local`에는 트랜잭션이 없다. 패널(초안 자동 저장)과 채팅 탭(답변 저장)이 동시에 `get → 수정 → set` 하면 한쪽 변경이 사라진다.
→ 모든 쓰기를 `dl:op` 메시지로 백그라운드에 보내고, 백그라운드는 Promise 체인으로 **순서대로 하나씩** 처리한다.
읽기는 각자 `storage.get`으로 하고, 변경은 `storage.onChanged`로 받는다.

### 2. 저장소 연산은 순수 함수

`lib/store.js`의 `apply(db, op, args)`는 chrome API에 의존하지 않는다. node 테스트에서 그대로 검증한다.
입력 길이 제한, 참조 무결성(없는 문항에 버전 추가 금지), 최종본 단일성, 백업 파일 검증을 여기서 처리한다.

### 3. 공용 텍스트 모듈은 전역 스크립트

콘텐츠 스크립트는 ES 모듈을 쓸 수 없으므로 `lib/text.js`는 전역 `DL`로 내보내는 클래식 스크립트로 만든다.
패널과 콘텐츠 스크립트가 같은 글자수·요청문 로직을 쓴다.

### 4. 채팅 페이지 DOM은 읽기만

ChatGPT·Claude는 React로 그려진다. 버튼을 메시지 안에 끼워 넣으면 재렌더링 때 사라지거나 React 오류를 낸다.
→ `<html>` 끝에 shadow DOM 호스트 하나만 붙이고, 버튼은 마우스가 올라간 답변 위치에 `position: fixed`로 띄운다.
스타일은 `adoptedStyleSheets`로 넣어 페이지 CSP와 CSS 충돌을 피한다.

### 5. DOM 변경 대비

- 답변·입력창 셀렉터를 사이트별 후보 목록으로 둔다 (`MESSAGE_SELECTORS`, `COMPOSER_SELECTORS`).
- 셀렉터가 모두 깨져도 **드래그 선택 저장**과 **우클릭 메뉴**는 DOM 구조와 무관하게 동작한다.
- 입력창 삽입은 `paste` 이벤트 → `execCommand('insertText')` 순서로 시도하고, 실패하면 패널이 클립보드 복사로 대신한다.

### 6. PC 폴더 자동 저장은 사본

확장을 지우면 `chrome.storage.local`도 함께 지워진다. 이를 대비해 사용자가 고른 폴더에 JSON 사본을 쓴다.

- **기준은 여전히 `chrome.storage.local`**. 파일 쓰기가 실패해도 앱은 그대로 동작하고, 패널 상단에 상태만 알린다.
- 폴더 핸들은 IndexedDB(`draftlog`/`kv`/`dir`)에 두고 패널과 서비스 워커가 같이 쓴다. 파일은 **서비스 워커가 쓴다** → 패널이 닫혀 있어도 채팅 탭에서 저장한 내용이 반영된다.
- 쓰기가 끝나고 1.5초 동안 추가 변경이 없으면 저장한다(연속 입력은 한 번으로 묶음).
- `createWritable()`은 임시 파일에 쓰고 `close()` 때 교체하므로 쓰다 끊겨도 파일이 반쯤 깨지지 않는다.
- 폴더 구성
  - `draftlog.json`: 최신본. 형식은 "백업 파일 내보내기"와 같다(+ `updatedAt`) → 기존 불러오기와 호환.
  - `backups/draftlog-YYYYMMDD.json`: 날짜별 스냅샷. 그날 마지막 상태가 남고 최근 14개만 유지.
  - `backups/before-load-*.json`, `backups/before-overwrite-*.json`: 충돌을 해결할 때 버려지는 쪽. 자동으로 지우지 않는다.
- **덮어쓰기 방지**: 마지막으로 쓴 시각(`fileSync.at`)보다 폴더 파일의 `updatedAt`이 뒤이고 내용이 다르면(다른 PC, 재설치 후 같은 폴더 선택) 쓰지 않고 `conflict` 상태로 사용자에게 고르게 한다. 새 폴더를 연결할 때는 `at`을 0으로 돌려 기존 파일이 있으면 항상 묻는다.
- 권한: 브라우저를 다시 켜면 폴더 접근이 `prompt`로 돌아갈 수 있다. 서비스 워커는 권한을 요청할 수 없어서 `permission` 상태로 두고, 패널의 **다시 허용** 클릭에서 `requestPermission`을 부른다.

## 데이터 모델

`chrome.storage.local`

```jsonc
{
  "db": {
    "schema": 1,
    "apps": { "<id>": { "company": "", "role": "", "deadline": "YYYY-MM-DD", "jd": "", "createdAt": 0 } },
    "qs":   { "<id>": { "appId": "", "title": "", "limit": 1000, "mode": "with|without|bytes",
                        "order": 1, "draft": "", "createdAt": 0, "updatedAt": 0 } },
    "vers": { "<id>": { "qid": "", "text": "", "message": "", "source": "me|gpt|claude",
                        "url": "https://…", "createdAt": 0, "final": false } }
  },
  "activeQ": "<문항 id>",  // 패널에서 보고 있는 문항. 채팅 탭의 저장 카드 기본값
  "fileSync": {             // PC 폴더 자동 저장 상태 (백그라운드만 씀)
    "on": true, "name": "폴더 이름", "at": 0,          // at: 마지막으로 파일을 쓴 시각
    "state": "ok|permission|conflict|error|off", "error": "",
    "file": { "updatedAt": 0, "apps": 0, "qs": 0, "vers": 0 }   // conflict일 때 폴더 파일 정보
  },
  "fileNudgeOff": false     // 목록의 "브라우저에만 저장돼요" 안내를 닫았는지
}
```

- 버전 번호(v1, v2…)는 저장하지 않고 `createdAt` 순서로 계산한다. 중간 버전을 지워도 번호가 자연스럽게 당겨진다.
- 마지막 버전과 내용이 같으면 새 버전을 만들지 않는다.
- 삭제는 하위까지 함께 지운다 (지원서 → 문항 → 버전).

## 메시지 규약

| type | 보내는 곳 → 받는 곳 | 내용 |
| --- | --- | --- |
| `dl:op` | 패널·콘텐츠 → 백그라운드 | `{op, args}` → `{ok, result \| error}` |
| `dl:insert` | 패널 → 콘텐츠 | `{text}` → `{ok}` 입력창 삽입 결과 |
| `dl:openSave` | 백그라운드 → 콘텐츠 | 우클릭 메뉴로 저장 카드 열기 |
| `dl:openPanel` | 콘텐츠 → 백그라운드 | 사이드 패널 열기 (미지원 브라우저는 팝업 창) |
| `dl:file` | 패널 → 백그라운드 | `{act: connect \| sync \| overwrite \| adopt \| off}` → `{ok, result: fileSync}` |

## 텍스트 처리

- **글자수**: 공백 포함(줄바꿈 포함), 공백 제외, 바이트(EUC-KR 방식: 비ASCII 2, ASCII 1, 줄바꿈 2). `\r\n`은 한 줄바꿈으로 센다.
- **비교**: 어절·문장부호 단위 토큰으로 LCS를 구한 뒤, 3글자 이하 공통 조각으로 잘게 쪼개진 변경은 한 덩어리로 묶어 읽기 쉽게 만든다.
- **요청문**: 역할 지시 + 지원 정보 + 공고 메모 + 문항 + 글자수 제한(현재 글자수 포함) + 현재 답변 + 요청 종류별 지시. 사실관계를 지어내지 말라는 조건을 항상 넣는다.

## 권한

| 권한 | 이유 |
| --- | --- |
| `storage`, `unlimitedStorage` | 버전 데이터 저장 (기본 10MB 제한 해제) |
| `sidePanel` | 사이드 패널 |
| `contextMenus` | 선택 영역 저장 메뉴 |
| host: chatgpt.com, chat.openai.com, claude.ai | 콘텐츠 스크립트, 활성 탭 URL 확인 |

`tabs`, `scripting`, `<all_urls>`는 요청하지 않는다. PC 폴더 저장은 매니페스트 권한 없이, 사용자가 폴더를 고를 때 브라우저가 따로 허락을 받는다.
