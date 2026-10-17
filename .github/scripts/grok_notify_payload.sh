#!/usr/bin/env bash
# Grok 通知用 JSON ペイロードを stdout に出力する。
# 入力は環境変数: EVENT_TYPE, ACTION, REPOSITORY, ISSUE_NUMBER, ISSUE_TITLE,
#   ISSUE_URL, COMMENT_BODY, COMMENT_URL, AUTHOR, IS_PULL_REQUEST
# 前提: ISSUE_NUMBER は整数文字列、IS_PULL_REQUEST は "true"/"false"
#   （それ以外は jq 側で false / エラーとして安全に扱う）。
set -euo pipefail

jq -n \
  --arg event_type "${EVENT_TYPE:-}" \
  --arg action "${ACTION:-}" \
  --arg repository "${REPOSITORY:-}" \
  --arg number "${ISSUE_NUMBER:-}" \
  --arg title "${ISSUE_TITLE:-}" \
  --arg url "${ISSUE_URL:-}" \
  --arg body "${COMMENT_BODY:-}" \
  --arg curl_ "${COMMENT_URL:-}" \
  --arg author "${AUTHOR:-}" \
  --arg is_pr "${IS_PULL_REQUEST:-false}" \
  '{
    event_type: $event_type,
    action: $action,
    repository: $repository,
    issue: { number: ($number | tonumber), title: $title, url: $url },
    comment: { body: $body, url: $curl_ },
    author: $author,
    is_pull_request: ($is_pr == "true")
  }'
