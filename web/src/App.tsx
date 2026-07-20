import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  Search,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RunState = "idle" | "loading" | "complete" | "error";

interface AgentStep {
  index: number;
  tool: string;
  summary: string;
  error?: string;
}

interface InvestigationResult {
  answer: string;
  steps: AgentStep[];
  iterations: number;
  model: string;
  status: "complete" | "partial";
}

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

const LOADING_STEPS = [
  "Mapping services",
  "Reading telemetry",
  "Following traces",
  "Checking changes",
  "Writing assessment",
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
      if (line.startsWith("## ")) {
        flush();
        output.push({ type: "heading", value: line.slice(3) });
      } else if (line.startsWith("- ")) {
        list.push(line.slice(2));
      } else if (line) {
        flush();
        output.push({ type: "paragraph", value: line.replaceAll("**", "") });
      }
    }
    flush();
    return output;
  }, [text]);

  const withCode = (value: string) =>
    value.split(/(`[^`]+`)/g).map((part, index) =>
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

function LoadingState({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex min-h-[530px] flex-col items-center justify-center px-8">
      <LoaderCircle className="mb-5 size-5 animate-spin text-foreground" strokeWidth={1.5} />
      <h2 className="text-sm font-medium">Investigating incident</h2>
      <div className="mt-6 w-full max-w-[250px] space-y-3">
        {LOADING_STEPS.map((step, index) => (
          <div key={step} className="flex items-center gap-3 text-xs">
            <span className={cn("grid size-4 place-items-center rounded-full text-muted-foreground", index < activeStep && "bg-foreground text-background", index === activeStep && "shadow-[inset_0_0_0_1px_hsl(var(--foreground))]")}>
              {index < activeStep ? <Check className="size-2.5" strokeWidth={2.5} /> : <span className="size-1 rounded-full bg-current" />}
            </span>
            <span className={cn("text-muted-foreground", index === activeStep && "text-foreground")}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultState({ result }: { result: InvestigationResult }) {
  return (
    <div className="result-enter p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Incident report</h2>
        <Badge variant="outline">
          <Check className="size-3" />
          {result.status === "complete" ? "Complete" : "Partial"}
        </Badge>
      </div>

      <Report text={result.answer} />

      <Separator className="my-7" />

      <details open className="group">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-xs font-medium select-none">
          <span className="flex items-center gap-2"><Terminal className="size-3.5 text-muted-foreground" />Tool trace</span>
          <span className="flex items-center gap-2 text-[11px] font-normal tabular-nums text-muted-foreground">
            {result.steps.length} calls · {result.iterations} turns
            <ChevronDown className="size-3.5 transition-transform duration-150 group-open:rotate-180" />
          </span>
        </summary>
        <ol className="mt-2 border-l border-border pl-4">
          {result.steps.map((step) => (
            <li key={`${step.index}-${step.tool}`} className="relative py-3 first:pt-2">
              <span className="absolute -left-[18px] top-[18px] size-1.5 rounded-full bg-muted-foreground" />
              <div className="font-mono text-[11px] text-foreground">{step.tool}</div>
              <p className="mt-1 text-pretty text-[11px] leading-relaxed text-muted-foreground">{step.summary}</p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function App() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [lastQuestion, setLastQuestion] = useState(DEFAULT_QUESTION);
  const [state, setState] = useState<RunState>("idle");
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [error, setError] = useState("");
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (state !== "loading") return;
    setActiveStep(0);
    const timer = window.setInterval(() => setActiveStep((current) => Math.min(current + 1, LOADING_STEPS.length - 1)), 2300);
    return () => window.clearInterval(timer);
  }, [state]);

  async function runInvestigation(value: string) {
    const cleanQuestion = value.trim();
    if (cleanQuestion.length < 8) return;
    setLastQuestion(cleanQuestion);
    setState("loading");
    setError("");

    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion }),
      });
      const data = await response.json() as InvestigationResult & { error?: string };
      if (!response.ok) throw new Error(data.error || `Request failed with status ${response.status}`);
      setResult(data);
      setState("complete");
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

        <div className="grid overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_hsl(var(--border)),0_12px_32px_hsl(var(--foreground)/0.04)] lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="border-b border-border bg-muted/25 p-5 lg:border-b-0 lg:border-r lg:p-6">
            <form onSubmit={handleSubmit}>
              <label htmlFor="question" className="label mb-3 block">Investigation prompt</label>
              <div className="rounded-xl bg-background p-1 shadow-[0_0_0_1px_hsl(var(--border)),0_1px_2px_hsl(var(--foreground)/0.04)] focus-within:shadow-[0_0_0_1px_hsl(var(--foreground))]">
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
            {state === "loading" && <LoadingState activeStep={activeStep} />}
            {state === "complete" && result && <ResultState result={result} />}
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
