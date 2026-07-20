import { describe, expect, it } from "vitest";
import { executeTelemetryTool } from "../src/telemetry";

describe("telemetry tools", () => {
  it("returns service topology", () => {
    const result = executeTelemetryTool("list_services", {}) as { services: unknown[] };
    expect(result.services).toHaveLength(5);
  });

  it("supports current-to-baseline metric comparisons", () => {
    const current = executeTelemetryTool("query_metrics", {
      service: "inventory-api",
      metric: "cache_hit_rate",
      window: "last_15m",
    }) as { value: number };
    const baseline = executeTelemetryTool("query_metrics", {
      service: "inventory-api",
      metric: "cache_hit_rate",
      window: "baseline_24h",
    }) as { value: number };
    expect(current.value).toBe(0.2);
    expect(baseline.value).toBe(94.6);
  });

  it("connects error logs to an inspectable trace", () => {
    const logs = executeTelemetryTool("search_logs", {
      service: "checkout-api",
      level: "error",
    }) as { logs: Array<{ traceId: string }> };
    expect(logs.logs[0]?.traceId).toBe("tr-a91f2");

    const trace = executeTelemetryTool("inspect_trace", { trace_id: logs.logs[0]?.traceId }) as {
      spans: Array<{ operation: string; durationMs: number }>;
    };
    expect(trace.spans).toContainEqual(expect.objectContaining({ operation: "pool.acquire", durationMs: 3900 }));
  });

  it("exposes the causal configuration diff", () => {
    const result = executeTelemetryTool("list_recent_changes", { service: "inventory-api" }) as {
      changes: Array<{ diff: Record<string, { before: string; after: string }> }>;
    };
    expect(result.changes[0]?.diff.CACHE_TTL_SECONDS).toEqual({ before: "300", after: "0" });
  });

  it("rejects invalid service names", () => {
    expect(() => executeTelemetryTool("query_metrics", {
      service: "made-up-service",
      metric: "error_rate",
      window: "last_15m",
    })).toThrow("Unknown service");
  });
});
