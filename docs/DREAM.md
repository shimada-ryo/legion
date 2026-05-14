# DREAM.md

将来やりたいことのメモ。spec 化やロードマップ化されていないが、忘れないように残しておく。
書く時は「いつ・誰が・なぜ思ったか」を一緒に残す。

## Instance のセッションログを SQLite に永続化する

- **発端:** 2026-05-15 / Web UI flow editor の brainstorming
- **やりたいこと:**
  - Instance canvas で drag した位置や、その他の閲覧時の interaction を「セッション」として SQLite に記録する。
  - 「いつ、どの instance を、どう眺めたか」が後から振り返れるようにする。layout もその一部。
- **直近のスコープでの扱い:**
  - 今回の flow drag 実装では Instance の drag は in-session のみ。
  - SQLite への永続化は将来仕事として明示的に切り出している。
- **今回 spec との関係:**
  - 今回の drag 実装では Instance の位置は `templateSnapshot` の位置から派生 + React state での一時保持に留める。
  - 永続化を後から足すときは、`agent_instance` / `workflow_instance` 周辺のテーブルに layout を含むセッションログを add column / 別テーブルで足す方向で良いはず。
