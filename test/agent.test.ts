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
  it("uses multiple evidence types before returning a conclusion", async () => {
    const responses = [
      toolTurn("call_1", "list_services", {}),
      toolTurn("call_2", "search_logs", { service: "checkout-api", level: "error" }),
      toolTurn("call_3", "inspect_trace", { trace_id: "tr-a91f2" }),
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
    const ai: AiRunner = {
      async run(_model, input) {
        requests.push(input);
        const response = responses.shift();
        if (!response) throw new Error("Unexpected model turn");
        return response;
      },
    };

    const result = await investigate(ai, "Why is checkout failing right now?");

    expect(result.status).toBe("complete");
    expect(result.steps.map((step) => step.tool)).toEqual(["list_services", "search_logs", "inspect_trace"]);
    expect(result.answer).toContain("## Assessment");
    expect(requests).toHaveLength(4);
    expect(requests[0]?.tool_choice).toBe("required");
    expect(requests[3]?.tool_choice).toBe("auto");
  });

  it("returns a safe partial report when inference fails", async () => {
    const ai: AiRunner = { async run() { throw new Error("upstream unavailable"); } };
    const result = await investigate(ai, "Investigate the current checkout incident.");
    expect(result.status).toBe("partial");
    expect(result.answer).toContain("CACHE_TTL_SECONDS");
  });
});
