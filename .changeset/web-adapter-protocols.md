---
"@chat-adapter/web": minor
"@chat-adapter/catalog": patch
---

The Web adapter's server entry no longer depends on the AI SDK at runtime, and a new `protocol` option lets it speak AG-UI (`protocol: "ag-ui"`) for TanStack AI and other AG-UI clients. The default stays `"ai-sdk"`. `ai` is now an optional peer dependency, needed only for the `react`, `vue`, and `svelte` helpers. `message.raw` is now typed as the new `WebMessage` type instead of the AI SDK `UIMessage`.
