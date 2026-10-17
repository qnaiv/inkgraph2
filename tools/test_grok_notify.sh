#!/usr/bin/env bash
# grok-notify のペイロード生成と workflow 内容の簡易検証（ネットワーク不使用）
set -euo pipefail
cd "$(dirname "$0")/.."
S=.github/scripts/grok_notify_payload.sh
W=.github/workflows/grok-notify.yml

check() { echo "$1" | jq -e "$2" >/dev/null || { echo "FAIL: $2"; echo "$1"; exit 1; }; }

out=$(EVENT_TYPE=issue_comment ACTION=created REPOSITORY=qnaiv/inkgraph2 ISSUE_NUMBER=12 \
  ISSUE_TITLE='Fix "quote" bug' ISSUE_URL=https://github.com/qnaiv/inkgraph2/issues/12 \
  COMMENT_BODY=$'@grok 調べて\n2行目' COMMENT_URL=https://github.com/qnaiv/inkgraph2/issues/12#issuecomment-1 \
  AUTHOR=qnaiv IS_PULL_REQUEST=false bash "$S")
check "$out" '.event_type == "issue_comment" and .action == "created"'
check "$out" '.repository == "qnaiv/inkgraph2"'
check "$out" '.issue.number == 12 and (.issue.number | type) == "number"'
check "$out" '.issue.title == "Fix \"quote\" bug" and (.issue.url | endswith("/issues/12"))'
check "$out" '(.comment.body | startswith("@grok")) and (.comment.url | contains("issuecomment"))'
check "$out" '.author == "qnaiv" and .is_pull_request == false and (.is_pull_request | type) == "boolean"'

out=$(EVENT_TYPE=issues ACTION=opened REPOSITORY=qnaiv/inkgraph2 ISSUE_NUMBER=7 \
  ISSUE_TITLE='New PR thing' ISSUE_URL=https://github.com/qnaiv/inkgraph2/pull/7 \
  COMMENT_BODY='@grok お願い' COMMENT_URL=https://github.com/qnaiv/inkgraph2/pull/7 \
  AUTHOR=qnaiv IS_PULL_REQUEST=true bash "$S")
check "$out" '.event_type == "issues" and .action == "opened"'
check "$out" '.issue.number == 7 and (.issue.number | type) == "number"'
check "$out" '.issue.title == "New PR thing" and .issue.url == .comment.url'
check "$out" '.comment.body == "@grok お願い" and .author == "qnaiv"'
check "$out" '.is_pull_request == true and (.is_pull_request | type) == "boolean"'

for s in 'issue_comment:' 'issues:' 'types: [created]' 'types: [opened]' \
  "github.event.comment.user.login == 'qnaiv'" "github.event.issue.user.login == 'qnaiv'" \
  "contains(github.event.comment.body, '@grok')" "contains(github.event.issue.body, '@grok')" \
  'secrets.GROK_WEBHOOK_URL' 'secrets.GROK_WEBHOOK_KEY' '::warning::' \
  '::add-mask::$GROK_WEBHOOK_URL' '::add-mask::$GROK_WEBHOOK_KEY' \
  'configured=true' 'steps.check.outputs.configured'; do
  grep -qF -- "$s" "$W" || { echo "FAIL: workflow missing: $s"; exit 1; }
done
# secrets を job if に直接書いていないこと
if awk '/^    if:/{f=1;next} /^    steps:/{f=0} f' "$W" | grep -qF 'secrets.'; then
  echo "FAIL: secrets in job if"; exit 1
fi
echo PASS
