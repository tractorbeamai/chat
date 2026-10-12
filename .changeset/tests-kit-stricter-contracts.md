---
"@chat-adapter/tests": patch
---

Tighten the shared contract suites so they fail for the behavior they describe:

- `connectWebhookContract` checks that the verifier receives the exact raw request body, and its `401` cases now require the verifier to have run, so a rejection from another gate no longer counts as a pass. The redundant "constructs with a webhookVerifier" case is removed.
- `selfMessageContract` fails when a bot-authored message reaches any `process*` handler or `handleIncomingMessage`, not only `dispatchHandler`.
- `threadIdContract` throws when given no cases, registers "matches pinned encoded strings" only when a case pins an `encoded` value, and names the offending id when the prefix check fails.
- `toHaveDispatched` accepts `processAgentSessionStopped` and `processAgentSessionTitleChanged`.
