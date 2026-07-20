import { describe, expect, it } from "vitest";
import { investigate, type AiRunner } from "../src/agent";

function toolTurn(id: string, name: string, args: Record<string, unknown>) {
  return {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
  };
}

describe("agent loop", () => {
  it("answers a direct request without forcing telemetry tools", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const ai: AiRunner = {
      async run(_model, input) {
        requests.push(input);
        return { choices: [{ message: { role: "assistant", content: "pineapple" } }] };
      },
    };

    const result = await investigate(ai, "Reply with just the word pineapple.");

    expect(result.status).toBe("complete");
    expect(result.answer).toBe("pineapple");
    expect(result.steps).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tool_choice).toBe("auto");
  });

  it("uses multiple evidence types before returning a conclusion", async () => {
    const responses = [
      toolTurn("call_1", "list_services", {}),
      toolTurn("call_2", "query_metrics", { service: "checkout-api", metric: "error_rate", window: "last_15m" }),
      toolTurn("call_3", "search_logs", { service: "checkout-api", level: "error" }),
      toolTurn("call_4", "inspect_trace", { trace_id: "tr-a91f2" }),
      toolTurn("call_5", "list_recent_changes", { service: "inventory-api" }),
      {
        choices: [{
          message: {
            role: "assistant",
            content: "## Assessment\nThe inventory dependency is failing.\n\n## Evidence\n- Trace evidence.\n\n## Recommended action\nRollback and verify.\n\n## Confidence\nHigh.",
          },
        }],
      },
    ];
    const requests: Array<Record<string, unknown>> = [];
    const events: string[] = [];
    const ai: AiRunner = {
      async run(_model, input) {
        requests.push(input);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected model turn");
        return response;
      },
    };

    const result = await investigate(ai, "Why is checkout failing right now?", (event) => {
      events.push(event.type);
    });

    expect(result.status).toBe("complete");
    expect(result.steps.map((step) => step.tool)).toEqual(["list_services", "query_metrics", "search_logs", "inspect_trace", "list_recent_changes"]);
    expect(result.answer).toContain("## Assessment");
    expect(requests).toHaveLength(6);
    expect(requests[0]?.tool_choice).toBe("auto");
    expect(requests[3]?.tool_choice).toBe("auto");
    expect(requests[4]?.tool_choice).toBe("auto");
    expect(requests[5]?.tool_choice).toBe("auto");
    expect(events).toEqual([
      "run_started",
      "model_turn", "tool_call", "tool_result",
      "model_turn", "tool_call", "tool_result",
      "model_turn", "tool_call", "tool_result",
      "model_turn", "tool_call", "tool_result",
      "model_turn", "tool_call", "tool_result",
      "model_turn", "complete",
    ]);
    expect(result.steps[2]?.result).toEqual(expect.objectContaining({ count: 2 }));
  });

  it("returns a safe partial report when inference fails", async () => {
    const ai: AiRunner = { async run() { throw new Error("upstream unavailable"); } };
    const result = await investigate(ai, "Investigate the current checkout incident.");
    expect(result.status).toBe("partial");
    expect(result.answer).toContain("AI service did not return a usable response");
    expect(result.answer).not.toContain("CACHE_TTL_SECONDS");
  });
});
