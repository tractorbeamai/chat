/**
 * Wire protocols the Web adapter can speak.
 *
 * The adapter itself only deals in protocol-neutral pieces: a parsed request
 * (conversation id plus the latest user message) and a handful of stream
 * events. Each protocol maps those onto its own request body and SSE frames,
 * so the server needs no client SDK at runtime.
 */

import type { WebMessage, WebMessagePart, WebProtocolName } from "./types";

/** Protocol-neutral events emitted while the handler runs. */
export type WebStreamEvent =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string };

/** What a protocol extracts from the request body. */
export interface WebProtocolRequest {
  /** Client-supplied conversation id, if any. */
  conversationId?: string;
  /**
   * Latest user message with only the parts this protocol allows. `null`
   * when the body has no user message.
   */
  message: WebMessage | null;
  /** Client-supplied run id, if any. */
  runId?: string;
}

/** Ids shared by every frame of one response. */
export interface WebRunContext {
  conversationId: string;
  runId: string;
}

export interface WebProtocol {
  /** Payloads to send when the response starts. */
  begin(run: WebRunContext): unknown[];
  /** Raw SSE frame written after the last event, if the protocol has one. */
  readonly doneFrame?: string;
  /** Payload for one stream event. */
  encode(event: WebStreamEvent): unknown;
  /** Payloads to send when the response ends, with `errorText` on failure. */
  end(run: WebRunContext, errorText?: string): unknown[];
  readonly headers: Record<string, string>;
  /** Returns `null` when the body is not a valid request for this protocol. */
  parseRequest(body: unknown): WebProtocolRequest | null;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  // Disable nginx buffering so deltas reach the browser immediately.
  "x-accel-buffering": "no",
};

/**
 * AI SDK UI message stream protocol, consumed by `useChat` from
 * `@ai-sdk/react`, `@ai-sdk/vue`, and `@ai-sdk/svelte`.
 *
 * https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */
const aiSdkProtocol: WebProtocol = {
  headers: { ...SSE_HEADERS, "x-vercel-ai-ui-message-stream": "v1" },
  doneFrame: "data: [DONE]\n\n",

  parseRequest(body) {
    if (!(isRecord(body) && isNonEmptyArray(body.messages))) {
      return null;
    }
    const last = findLastUserMessage(body.messages);
    return {
      conversationId: typeof body.id === "string" ? body.id : undefined,
      // Tool parts are dropped so a browser can't inject forged tool-call or
      // approval state. Text, file, and custom data parts pass through.
      message: last && {
        ...last,
        id: messageId(last),
        role: "user",
        parts: partsOf(last.parts).filter(
          (part) =>
            part.type === "text" ||
            part.type === "file" ||
            part.type.startsWith("data-")
        ),
      },
    };
  },

  begin: (run) => [
    { type: "start", messageId: run.runId },
    { type: "start-step" },
  ],

  encode: (event) => event,

  end: (_run, errorText) => [
    { type: "finish-step" },
    { type: "finish" },
    ...(errorText === undefined ? [] : [{ type: "error", errorText }]),
  ],
};

const AG_UI_CONTENT_TYPES = new Set([
  "image",
  "audio",
  "video",
  "document",
  "binary",
]);

/**
 * AG-UI protocol, consumed by TanStack AI (`fetchServerSentEvents`),
 * CopilotKit, and other AG-UI clients.
 *
 * https://docs.ag-ui.com/concepts/events
 */
const agUiProtocol: WebProtocol = {
  headers: SSE_HEADERS,

  parseRequest(body) {
    if (!(isRecord(body) && isNonEmptyArray(body.messages))) {
      return null;
    }
    const last = findLastUserMessage(body.messages);
    return {
      conversationId:
        typeof body.threadId === "string" ? body.threadId : undefined,
      runId: typeof body.runId === "string" ? body.runId : undefined,
      message: last && {
        id: messageId(last),
        role: "user",
        parts: agUiContentToParts(last.content),
      },
    };
  },

  begin: (run) => [
    { type: "RUN_STARTED", threadId: run.conversationId, runId: run.runId },
  ],

  encode(event) {
    switch (event.type) {
      case "text-start":
        return {
          type: "TEXT_MESSAGE_START",
          messageId: event.id,
          role: "assistant",
        };
      case "text-delta":
        return {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: event.id,
          delta: event.delta,
        };
      default:
        return { type: "TEXT_MESSAGE_END", messageId: event.id };
    }
  },

  // RUN_ERROR is terminal in AG-UI, so it replaces RUN_FINISHED.
  end: (run, errorText) =>
    errorText === undefined
      ? [
          {
            type: "RUN_FINISHED",
            threadId: run.conversationId,
            runId: run.runId,
          },
        ]
      : [{ type: "RUN_ERROR", message: errorText }],
};

export const webProtocols: Record<WebProtocolName, WebProtocol> = {
  "ai-sdk": aiSdkProtocol,
  "ag-ui": agUiProtocol,
};

/**
 * Build an SSE response whose body is fed by `run`. `run` must not reject;
 * the stream closes when it settles.
 */
export function createSseResponse(
  protocol: WebProtocol,
  run: (send: (payload: unknown) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // The client went away and the stream is closed. Keep running so
          // the handler can finish its own cleanup.
        }
      };
      run((payload) => enqueue(`data: ${JSON.stringify(payload)}\n\n`)).then(
        () => {
          if (protocol.doneFrame) {
            enqueue(protocol.doneFrame);
          }
          try {
            controller.close();
          } catch {
            // Already closed or cancelled.
          }
        }
      );
    },
  });
  return new Response(body, { headers: protocol.headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function findLastUserMessage(
  messages: unknown[]
): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isRecord(m) && m.role === "user") {
      return m;
    }
  }
  return null;
}

function messageId(message: Record<string, unknown>): string {
  return typeof message.id === "string" ? message.id : generateId();
}

function partsOf(value: unknown): WebMessagePart[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (part): part is WebMessagePart =>
      isRecord(part) && typeof part.type === "string"
  );
}

/** Map AG-UI user content (a string or content parts) onto message parts. */
function agUiContentToParts(content: unknown): WebMessagePart[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  const parts: WebMessagePart[] = [];
  for (const part of partsOf(content)) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
    } else if (AG_UI_CONTENT_TYPES.has(part.type)) {
      parts.push(part);
    }
  }
  return parts;
}

export function generateId(): string {
  // crypto.randomUUID is available in Node 19+ and modern browsers.
  // Fallback ensures we don't hard-fail if it's missing.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
