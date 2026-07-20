import { investigate } from "./agent";
import type { Env, InvestigationEvent } from "./types";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}

async function readQuestion(request: Request): Promise<{ question: string } | { response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { response: json({ error: "Expected an application/json request body." }, 415) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: json({ error: "The request body is not valid JSON." }, 400) };
  }

  const question = (body as Record<string, unknown> | null)?.question;
  if (typeof question !== "string" || question.trim().length < 8) {
    return { response: json({ error: "Question must be at least 8 characters." }, 400) };
  }
  if (question.length > 800) {
    return { response: json({ error: "Question must be 800 characters or fewer." }, 400) };
  }

  return { question: question.trim() };
}

async function handleInvestigation(request: Request, env: Env): Promise<Response> {
  const parsed = await readQuestion(request);
  if ("response" in parsed) return parsed.response;

  try {
    const result = await investigate(env.AI as unknown as Parameters<typeof investigate>[0], parsed.question);
    return json(result);
  } catch (error) {
    console.error("Investigation request failed", error);
    return json({ error: "The investigation could not be completed. Please try again." }, 500);
  }
}

async function handleInvestigationStream(request: Request, env: Env): Promise<Response> {
  const parsed = await readQuestion(request);
  if ("response" in parsed) return parsed.response;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let clientOpen = true;
      const send = (event: InvestigationEvent) => {
        if (!clientOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          clientOpen = false;
        }
      };

      try {
        await investigate(env.AI as unknown as Parameters<typeof investigate>[0], parsed.question, send);
      } catch (error) {
        console.error("Streaming investigation failed", error);
        send({ type: "error", message: "The investigation could not be completed. Please try again." });
      } finally {
        if (clientOpen) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "signalflare-incident-agent", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/investigate/stream" && request.method === "POST") {
      return handleInvestigationStream(request, env);
    }

    if (url.pathname === "/api/investigate" && request.method === "POST") {
      return handleInvestigation(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    Object.entries(SECURITY_HEADERS).forEach(([key, value]) => headers.set(key, value));
    if (headers.get("content-type")?.includes("text/html")) {
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
