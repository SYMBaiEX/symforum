"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Send, Square, RotateCcw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

const starterPrompts = [
  "Check newsletter automation and tell me if the daily send is healthy.",
  "Review open system errors and tell me what needs attention.",
  "Summarize content, comments, and user activity across the platform.",
];

export function AdminAiChat() {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/admin/ai" }),
    [],
  );
  const [input, setInput] = useState("");
  const { error, messages, regenerate, sendMessage, status, stop } = useChat({
    transport,
    experimental_throttle: 80,
    onError: (chatError) => {
      reportAppError(chatError, {
        scope: "admin-ai",
        eventType: "admin_ai_chat_failed",
        component: "AdminAiChat",
        action: "api:/api/admin/ai",
        notify: false,
      });
    },
  });
  const isBusy = status === "submitted" || status === "streaming";

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }
    setInput("");
    await sendMessage({ text });
  }

  async function sendStarterPrompt(prompt: string) {
    if (isBusy) {
      return;
    }
    await sendMessage({ text: prompt });
  }

  return (
    <section className="mt-10 grid min-h-[34rem] gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-[34rem] flex-col border bg-background">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b p-4">
          <div>
            <p className="font-mono text-xs uppercase text-muted-foreground">
              Admin agent
            </p>
            <h2 className="mt-1 text-2xl font-semibold">SYMBaiEX operator</h2>
          </div>
          <div className="flex items-center gap-2">
            {isBusy ? (
              <Button size="sm" variant="outline" onClick={stop}>
                <Square aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => regenerate()}
                disabled={messages.length === 0}
              >
                <RotateCcw aria-hidden="true" />
                Regenerate
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="grid min-h-64 place-items-center text-center">
              <div>
                <p className="font-mono text-xs uppercase text-muted-foreground">
                  Owner-only tools are ready
                </p>
                <p className="mt-3 max-w-lg text-sm text-muted-foreground">
                  Ask for newsletter state, open errors, content inventory,
                  audience status, analytics, or queue explicit admin actions.
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))
          )}
          {error ? (
            <p className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error.message || "Admin AI request failed"}
            </p>
          ) : null}
        </div>

        <form onSubmit={submitPrompt} className="border-t p-4">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the admin agent to inspect, summarize, or queue an explicit platform action..."
            rows={4}
            disabled={isBusy}
          />
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={isBusy || !input.trim()}>
              <Send aria-hidden="true" />
              Ask agent
            </Button>
          </div>
        </form>
      </div>

      <aside className="grid gap-3 self-start border bg-background p-4">
        <p className="font-mono text-xs uppercase text-muted-foreground">
          Quick asks
        </p>
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => sendStarterPrompt(prompt)}
            disabled={isBusy}
            className="border px-3 py-2 text-left text-sm transition hover:border-foreground/40 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
        <p className="text-xs leading-5 text-muted-foreground">
          The route checks your signed-in Convex session and owner role before
          any AI or tool call runs.
        </p>
      </aside>
    </section>
  );
}

function ChatMessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <article
      className={cn(
        "max-w-[92%] border p-3",
        isUser
          ? "ml-auto border-primary/40 bg-primary/10"
          : "mr-auto border-border bg-muted/10",
      )}
    >
      <p className="mb-2 font-mono text-[11px] uppercase text-muted-foreground">
        {isUser ? "Austin" : "Agent"}
      </p>
      <div className="space-y-2">
        {message.parts.map((part, index) => (
          <ChatMessagePart key={index} part={part} />
        ))}
      </div>
    </article>
  );
}

function ChatMessagePart({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
    const record = part as unknown as Record<string, unknown>;
    const label =
      part.type === "dynamic-tool"
        ? String(record.toolName ?? "dynamic tool")
        : part.type.replace(/^tool-/, "");
    const state = String(record.state ?? "running");
    const payload =
      "output" in record
        ? record.output
        : "input" in record
          ? record.input
          : "errorText" in record
            ? record.errorText
            : null;
    return (
      <details className="border bg-background/60 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-mono uppercase text-muted-foreground">
          {label} / {state}
        </summary>
        {payload !== null ? (
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {safeStringify(payload)}
          </pre>
        ) : null}
      </details>
    );
  }

  return null;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
