import { describe, expectTypeOf, it } from "vitest";
import type { WebPlanData, WebTaskData, WebUIMessage } from "./index";

describe("WebUIMessage", () => {
  it("narrows data-task and data-plan parts to their payloads", () => {
    const parts: WebUIMessage["parts"] = [];
    for (const part of parts) {
      if (part.type === "data-task") {
        expectTypeOf(part.data).toEqualTypeOf<WebTaskData>();
        expectTypeOf(part.data.status).toEqualTypeOf<
          "pending" | "in_progress" | "complete" | "error"
        >();
      }
      if (part.type === "data-plan") {
        expectTypeOf(part.data).toEqualTypeOf<WebPlanData>();
        expectTypeOf(part.data.title).toBeString();
      }
    }
  });
});
