export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
}

export type ServiceName =
  | "edge-gateway"
  | "checkout-api"
  | "inventory-api"
  | "payments-api"
  | "postgres-primary";

export type TimeWindow = "last_15m" | "last_60m" | "baseline_24h";

export type MetricName =
  | "request_rate"
  | "error_rate"
  | "p95_latency_ms"
  | "db_connections"
  | "cache_hit_rate";

export interface AgentStep {
  index: number;
  tool: string;
  arguments: Record<string, unknown>;
  summary: string;
  durationMs: number;
  error?: string;
}

export interface InvestigationResult {
  answer: string;
  steps: AgentStep[];
  iterations: number;
  model: string;
  status: "complete" | "partial";
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}
