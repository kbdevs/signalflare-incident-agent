import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  Bot,
  Braces,
  Check,
  ChevronDown,
  LoaderCircle,
  Radio,
  RotateCcw,
  Search,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RunState = "idle" | "loading" | "complete" | "error";

interface AgentStep {
  index: number;
  iteration: number;
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  summary: string;
  durationMs: number;
  error?: string;
}

interface InvestigationResult {
  answer: string;
  steps: AgentStep[];
  iterations: number;
  model: string;
  status: "complete" | "partial";
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

type InvestigationEvent =
  | { type: "run_started"; model: string }
  | { type: "model_turn"; iteration: number; phase: "investigate" | "synthesize"; model: string }
  | { type: "tool_call"; iteration: number; call: ToolCall }
  | { type: "tool_result"; step: AgentStep }
  | { type: "complete"; result: InvestigationResult }
  | { type: "error"; message: string };

const DEFAULT_QUESTION = "Why are checkout requests failing, when did it start, and what should we do?";

const PRESETS = [
  "Find the first unhealthy dependency in the checkout path.",
  "Did a recent deployment cause this incident?",
  "Where is the checkout latency actually spent?",
];

const SERVICES = [
  { name: "edge-gateway", state: "degraded", detail: "12.8% errors" },
  { name: "checkout-api", state: "degraded", detail: "4.8s p95" },
  { name: "inventory-api", state: "critical", detail: "14.2% errors" },
  { name: "payments-api", state: "healthy", detail: "224ms p95" },
  { name: "postgres-primary", state: "saturated", detail: "98 / 100 conns" },
];

function Report({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const output: Array<{ type: "heading" | "paragraph" | "list"; value: string | string[] }> = [];
    let list: string[] = [];
    const flush = () => {
      if (list.length) output.push({ type: "list", value: list });
      list = [];
    };

    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (/^#{1,3}\s/.test(line)) {
        flush();
        output.push({ type: "heading", value: line.replace(/^#{1,3}\s+/, "") });
      } else if (line.startsWith("- ")) {
        list.push(line.slice(2));
      } else if (line) {
        flush();
        output.push({ type: "paragraph", value: line });
      }
    }
    flush();
    return output;
  }, [text]);

  const withCode = (value: string) =>
    value.replaceAll("**", "").split(/(`[^`]+`)/g).map((part, index) =>
      part.startsWith("`") && part.endsWith("`")
        ? <code key={index}>{part.slice(1, -1)}</code>
        : part,
    );

  return (
    <div className="report-copy">
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h3 key={index}>{block.value as string}</h3>;
        if (block.type === "list") {
          return <ul key={index}>{(block.value as string[]).map((item) => <li key={item}>{withCode(item)}</li>)}</ul>;
        }
        return <p key={index}>{withCode(block.value as string)}</p>;
      })}
    </div>
  );
}

function ServiceSnapshot() {
  return (
    <section aria-labelledby="services-heading" className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="services-heading" className="label">Service snapshot</h2>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">14:15 UTC</span>
      </div>
      <div className="overflow-hidden rounded-lg shadow-[0_0_0_1px_hsl(var(--border))]">
        {SERVICES.map((service, index) => (
          <div key={service.name} className={cn("flex min-h-11 items-center gap-3 px-3", index > 0 && "border-t border-border")}>
            <span className={cn("size-1.5 rounded-full bg-foreground", service.state === "healthy" && "bg-muted-foreground/35", service.state === "degraded" && "bg-muted-foreground/70")} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{service.name}</span>
            <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{service.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[530px] flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 grid size-10 place-items-center rounded-lg bg-muted shadow-[inset_0_0_0_1px_hsl(var(--border))]">
        <Search className="size-4 text-muted-foreground" strokeWidth={1.7} />
      </div>
      <h2 className="text-balance text-sm font-medium">No investigation yet</h2>
    </div>
  );
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function ActivityTimeline({ events, live, status }: { events: InvestigationEvent[]; live: boolean; status?: InvestigationResult["status"] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const model = events.find((event) => event.type === "run_started")?.model ?? "@cf/google/gemma-4-26b-a4b-it";
  const resultByCall = useMemo(() => new Map(
    events.filter((event): event is Extract<InvestigationEvent, { type: "tool_result" }> => event.type === "tool_result")
      .map((event) => [event.step.callId, event.step]),
  ), [events]);
  const visibleEvents = events.filter((event) => event.type === "model_turn" || event.type === "tool_call");

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <section aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6 md:px-8 md:pt-8">
        <div>
          <h2 id="activity-heading" className="text-sm font-semibold tracking-tight">Agent activity</h2>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">Workers AI · {model}</p>
        </div>
        <Badge variant={live ? "default" : "outline"}>
          {live ? <Radio className="size-3 animate-pulse" /> : status === "complete" ? <Check className="size-3" /> : <Activity className="size-3" />}
          {live ? "Live" : status === "complete" ? "Complete" : "Partial"}
        </Badge>
      </div>

      <div ref={scrollRef} className="mt-5 max-h-[560px] overflow-y-auto px-6 pb-6 md:px-8">
        {visibleEvents.length === 0 && (
          <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />Connecting to Workers AI
          </div>
        )}

        <ol className="border-l border-border pl-5">
          {visibleEvents.map((event, index) => {
            if (event.type === "model_turn") {
              return (
                <li key={`turn-${event.iteration}-${index}`} className="timeline-enter relative pb-5">
                  <span className="absolute -left-[27px] top-0 grid size-3 place-items-center rounded-full bg-background shadow-[0_0_0_1px_hsl(var(--border))]">
                    <span className="size-1 rounded-full bg-foreground" />
                  </span>
                  <div className="flex items-center gap-2">
                    <Bot className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">AI turn {event.iteration}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{event.phase === "synthesize" ? "synthesizing report" : "choosing next action"}</span>
                  </div>
                </li>
              );
            }

            const toolResult = resultByCall.get(event.call.id);
            return (
              <li key={event.call.id} className="timeline-enter relative pb-5">
                <span className="absolute -left-[27px] top-1 size-3 rounded-full bg-foreground shadow-[0_0_0_3px_hsl(var(--background))]" />
                <details open className="group overflow-hidden rounded-lg shadow-[0_0_0_1px_hsl(var(--border)),0_1px_2px_hsl(var(--foreground)/0.03)]">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 select-none">
                    <Wrench className="size-3.5 text-muted-foreground" />
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">{event.call.name}</code>
                    <span className="font-mono text-[9px] tabular-nums text-muted-foreground">turn {event.iteration}</span>
                    {toolResult ? <Check className="size-3 text-muted-foreground" /> : <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
                    <ChevronDown className="size-3 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
                  </summary>

                  <div className="border-t border-border bg-muted/20 px-3 py-3">
                    <div className="mb-1.5 flex items-center gap-1.5 label"><Braces className="size-3" />Arguments</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background p-2.5 font-mono text-[10px] leading-relaxed text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]">{formatJson(event.call.arguments)}</pre>

                    <div className="mb-1.5 mt-3 flex items-center justify-between gap-2">
                      <span className="label">Tool response</span>
                      {toolResult && <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{toolResult.durationMs}ms</span>}
                    </div>
                    {toolResult ? (
                      <>
                        <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2.5 font-mono text-[10px] leading-relaxed text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]">{formatJson(toolResult.result)}</pre>
                        <p className="mt-2 text-pretty text-[10px] leading-relaxed text-muted-foreground">{toolResult.summary}</p>
                      </>
                    ) : (
                      <div className="flex min-h-10 items-center gap-2 rounded-md bg-background px-2.5 text-[10px] text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]">
                        <LoaderCircle className="size-3 animate-spin" />Executing tool
                      </div>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>

        {live && visibleEvents.length > 0 && (
          <div className="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-foreground" />Waiting for the next model event
          </div>
        )}
      </div>
    </section>
  );
}

function ResultState({ result, events }: { result: InvestigationResult; events: InvestigationEvent[] }) {
  return (
    <div>
      <ActivityTimeline events={events} live={false} status={result.status} />
      <Separator />
      <div className="result-enter p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Response</h2>
          <Badge variant="outline">
            <Check className="size-3" />
            {result.status === "complete" ? "Complete" : "Partial"}
          </Badge>
        </div>
        <Report text={result.answer} />
      </div>
    </div>
  );
}

export function App() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [lastQuestion, setLastQuestion] = useState(DEFAULT_QUESTION);
  const [state, setState] = useState<RunState>("idle");
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<InvestigationEvent[]>([]);

  async function runInvestigation(value: string) {
    const cleanQuestion = value.trim();
    if (cleanQuestion.length < 8) return;
    setLastQuestion(cleanQuestion);
    setState("loading");
    setResult(null);
    setEvents([]);
    setError("");

    try {
      const response = await fetch("/api/investigate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || `Request failed with status ${response.status}`);
      }
      if (!response.body) throw new Error("The browser did not receive an event stream.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { value: chunk, done } = await reader.read();
        buffer += decoder.decode(chunk, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as InvestigationEvent;
          setEvents((current) => [...current, event]);

          if (event.type === "complete") {
            completed = true;
            setResult(event.result);
            setState("complete");
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }

        if (done) break;
      }

      if (!completed) throw new Error("The agent stream ended before the investigation completed.");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "The investigation could not be completed.");
      setState("error");
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runInvestigation(question);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-10">
        <div className="mb-6">
          <h1 className="text-balance text-xl font-semibold tracking-[-0.03em] md:text-2xl">Incident investigator</h1>
        </div>

        <div className="grid overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_20px_60px_rgb(0_0_0/0.42)] lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-border bg-muted/25 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <form onSubmit={handleSubmit}>
              <label htmlFor="question" className="label mb-3 block">Investigation prompt</label>
              <div className="rounded-xl bg-background p-1 shadow-[0_0_0_1px_rgb(255_255_255/0.08)] transition-[box-shadow] duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.28),0_0_0_4px_rgb(255_255_255/0.04)]">
                <Textarea
                  id="question"
                  value={question}
                  maxLength={800}
                  disabled={state === "loading"}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  aria-label="Incident question"
                />
                <Button type="submit" disabled={state === "loading" || question.trim().length < 8} className="h-10 w-full rounded-lg">
                  {state === "loading" ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
                  {state === "loading" ? "Investigating" : "Run investigation"}
                </Button>
              </div>
            </form>

            <div className="mt-5 space-y-1">
              <div className="label mb-2">Try asking</div>
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={state === "loading"}
                  onClick={() => { setQuestion(preset); void runInvestigation(preset); }}
                  className="min-h-10 w-full rounded-md px-2 text-left text-xs leading-snug text-muted-foreground transition-[background-color,color,scale] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
                >
                  {preset}
                </button>
              ))}
            </div>

            <ServiceSnapshot />
          </aside>

          <section aria-live="polite" aria-label="Investigation output" className="min-w-0 bg-background">
            {state === "idle" && <EmptyState />}
            {state === "loading" && <ActivityTimeline events={events} live />}
            {state === "complete" && result && <ResultState result={result} events={events} />}
            {state === "error" && (
              <div className="flex min-h-[530px] flex-col items-center justify-center px-8 text-center">
                <div className="mb-5 grid size-10 place-items-center rounded-lg bg-muted"><Activity className="size-4" /></div>
                <h2 className="text-sm font-medium">Investigation interrupted</h2>
                <p className="mt-2 max-w-xs text-pretty text-xs leading-relaxed text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="mt-5" onClick={() => void runInvestigation(lastQuestion)}>
                  <RotateCcw />Try again
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
