#!/usr/bin/env bash
# 크롬 웹 스토어 업로드·배포용 zip 만들기.
# manifest.json이 zip 최상단에 오도록 만든다 (폴더를 한 겹 더 감싸면 "매니페스트 없음" 오류가 난다).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/draftlog-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
zip -rq "$OUT" manifest.json background.js lib sidepanel content icons README.md
echo "만들었어요: $OUT"
unzip -l "$OUT" | tail -1
