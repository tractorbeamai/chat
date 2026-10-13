---
"@chat-adapter/slack": minor
---

Return every message ID from `SlackAdapter.stream()`. When a long reply rotates into several messages, the result now includes `messageIds`, which lists the messages of the reply in order. Its last entry is `id`. The new `SlackStreamResult` type describes the result.
