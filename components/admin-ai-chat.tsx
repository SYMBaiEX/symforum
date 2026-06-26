"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  MessageSquareText,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

const STORAGE_KEY = "symbaiex:admin-ai:threads:v1";
const MAX_STORED_THREADS = 18;

const starterPrompts = [
  "Check newsletter automation health.",
  "Review open system errors.",
  "Summarize community activity.",
  "Inspect content and portfolio state.",
];

type StoredConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
};

type ToolStep = {
  id: string;
  label: string;
  state: string;
  payload: unknown;
  isError: boolean;
};

export function AdminAiChat() {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const loaded = loadConversations();
    setConversations(loaded);
    setActiveId(loaded[0]?.id ?? "");
  }, []);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeId) ??
      conversations[0],
    [activeId, conversations],
  );

  const persistConversations = useCallback(
    (updater: (current: StoredConversation[]) => StoredConversation[]) => {
      setConversations((current) => {
        const next = updater(current).slice(0, MAX_STORED_THREADS);
        saveConversations(next);
        return next;
      });
    },
    [],
  );

  const createThread = useCallback(() => {
    const thread = createConversation();
    persistConversations((current) => [thread, ...current]);
    setActiveId(thread.id);
  }, [persistConversations]);

  const deleteThread = useCallback(
    (id: string) => {
      const remaining = conversations.filter(
        (conversation) => conversation.id !== id,
      );
      const next = remaining.length > 0 ? remaining : [createConversation()];
      setConversations(next);
      saveConversations(next);
      setActiveId(next[0]?.id ?? "");
    },
    [conversations],
  );

  const persistMessages = useCallback(
    (id: string, messages: UIMessage[]) => {
      persistConversations((current) => {
        const now = Date.now();
        const next = current.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                title: titleFromMessages(messages, conversation.title),
                updatedAt: now,
                messages,
              }
            : conversation,
        );
        return next.sort((a, b) => b.updatedAt - a.updatedAt);
      });
    },
    [persistConversations],
  );

  if (!activeConversation) {
    return null;
  }

  return (
    <section className="mt-8 grid min-h-[38rem] gap-6 xl:grid-cols-[13rem_minmax(0,1fr)_15rem]">
      <ConversationHistory
        activeId={activeConversation.id}
        conversations={conversations}
        onCreate={createThread}
        onDelete={deleteThread}
        onSelect={setActiveId}
      />

      <AdminAiSession
        key={activeConversation.id}
        conversation={activeConversation}
        onPersistMessages={persistMessages}
      />
    </section>
  );
}

function ConversationHistory({
  activeId,
  conversations,
  onCreate,
  onDelete,
  onSelect,
}: {
  activeId: string;
  conversations: StoredConversation[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="order-2 space-y-5 xl:order-1">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase text-muted-foreground">
          History
        </p>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground transition hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          New
        </button>
      </div>

      <div className="space-y-3">
        {conversations.map((conversation) => {
          const isActive = conversation.id === activeId;
          return (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-start gap-2",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(conversation.id)}
                className="min-w-0 flex-1 text-left"
                aria-current={isActive ? "page" : undefined}
              >
                <span
                  className={cn(
                    "block truncate text-sm font-medium transition",
                    isActive
                      ? "underline decoration-primary decoration-2 underline-offset-4"
                      : "hover:text-foreground",
                  )}
                >
                  {conversation.title}
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase">
                  {formatThreadDate(conversation.updatedAt)} /{" "}
                  {conversation.messages.length} msgs
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(conversation.id)}
                className="mt-0.5 opacity-0 transition hover:text-destructive group-hover:opacity-100"
                aria-label={`Delete ${conversation.title}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AdminAiSession({
  conversation,
  onPersistMessages,
}: {
  conversation: StoredConversation;
  onPersistMessages: (id: string, messages: UIMessage[]) => void;
}) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/admin/ai" }),
    [],
  );
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const {
    clearError,
    error,
    messages,
    regenerate,
    sendMessage,
    status,
    stop,
  } = useChat({
    id: conversation.id,
    messages: conversation.messages,
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
  const toolSteps = useMemo(() => collectToolSteps(messages), [messages]);

  useEffect(() => {
    onPersistMessages(conversation.id, messages);
  }, [conversation.id, messages, onPersistMessages]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }
    clearError();
    setInput("");
    await sendMessage({ text });
  }

  async function sendStarterPrompt(prompt: string) {
    if (isBusy) {
      return;
    }
    clearError();
    await sendMessage({ text: prompt });
  }

  return (
    <>
      <div className="order-1 flex min-h-[38rem] flex-col xl:order-2">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
          <div>
            <p className="font-mono text-[11px] uppercase text-muted-foreground">
              Admin agent
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              SYMBaiEX operator
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {isBusy ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground transition hover:text-foreground"
              >
                <Square className="size-3.5" aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => regenerate()}
                disabled={messages.length === 0}
                className="inline-flex items-center gap-2 font-mono text-xs uppercase text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Regenerate
              </button>
            )}
          </div>
        </div>

        <div
          ref={transcriptRef}
          className="max-h-[min(62vh,48rem)] min-h-0 flex-1 overflow-y-auto py-2 pr-1"
        >
          {messages.length === 0 ? (
            <EmptyChatState onPrompt={sendStarterPrompt} disabled={isBusy} />
          ) : (
            <div className="space-y-7">
              {messages.map((message) => (
                <ChatMessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}
          {error ? (
            <p className="mt-5 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message || "Admin AI request failed"}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={submitPrompt}
          className="mt-5 bg-muted/15 px-3 py-3 shadow-[0_-18px_42px_rgba(0,0,0,0.16)]"
        >
          <label htmlFor="admin-ai-input" className="sr-only">
            Ask admin agent
          </label>
          <textarea
            id="admin-ai-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask the agent to inspect, summarize, or queue an explicit platform action..."
            rows={3}
            disabled={isBusy}
            className="w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="hidden font-mono text-[10px] uppercase text-muted-foreground sm:block">
              Cmd+Enter to send
            </p>
            <Button type="submit" disabled={isBusy || !input.trim()}>
              <Send aria-hidden="true" />
              Ask agent
            </Button>
          </div>
        </form>
      </div>

      <ToolStepRail status={status} steps={toolSteps} />
    </>
  );
}

function EmptyChatState({
  disabled,
  onPrompt,
}: {
  disabled: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex min-h-80 items-center justify-center">
      <div className="w-full max-w-xl space-y-5 text-center">
        <MessageSquareText
          className="mx-auto size-7 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          Start with a platform check or ask for a specific admin action.
        </p>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-3">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPrompt(prompt)}
              disabled={disabled}
              className="font-mono text-[11px] uppercase text-muted-foreground underline decoration-transparent underline-offset-4 transition hover:text-foreground hover:decoration-primary disabled:pointer-events-none disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolStepRail({
  status,
  steps,
}: {
  status: string;
  steps: ToolStep[];
}) {
  const visibleSteps = steps.slice(-10).reverse();
  return (
    <aside className="order-3 space-y-5 xl:order-3">
      <div className="flex items-center gap-2">
        <Wrench className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="font-mono text-[11px] uppercase text-muted-foreground">
          Steps
        </p>
      </div>
      <div className="space-y-4">
        {visibleSteps.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Tool calls and step boundaries appear here as the agent works.
          </p>
        ) : (
          visibleSteps.map((step) => <ToolStepItem key={step.id} step={step} />)
        )}
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
        <PanelLeftOpen className="size-3.5" aria-hidden="true" />
        {status}
      </div>
    </aside>
  );
}

function ToolStepItem({ step }: { step: ToolStep }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <span
          className={cn(
            "block truncate font-mono text-[11px] uppercase underline decoration-transparent underline-offset-4 transition group-open:decoration-primary",
            step.isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {step.label} / {humanizeToolState(step.state)}
        </span>
      </summary>
      {step.payload !== null ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-2 font-mono text-[10px] leading-5 text-muted-foreground">
          {safeStringify(step.payload)}
        </pre>
      ) : null}
    </details>
  );
}

function ChatMessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <article
      className={cn(
        "max-w-[min(56rem,96%)]",
        isUser ? "ml-auto text-right" : "mr-auto",
      )}
    >
      <p className="mb-2 font-mono text-[11px] uppercase text-muted-foreground">
        {isUser ? "Austin" : "Agent"}
      </p>
      <div
        className={cn(
          "space-y-3",
          isUser ? "text-foreground" : "text-foreground",
        )}
      >
        {message.parts.map((part, index) => (
          <ChatMessagePart key={index} index={index} part={part} />
        ))}
      </div>
    </article>
  );
}

function ChatMessagePart({
  index,
  part,
}: {
  index: number;
  part: UIMessage["parts"][number];
}) {
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type === "step-start") {
    return index > 0 ? (
      <p className="font-mono text-[10px] uppercase text-muted-foreground/70">
        Step {index}
      </p>
    ) : null;
  }

  if (isToolPart(part)) {
    const step = stepFromPart(part, index);
    return <ToolStepItem step={step} />;
  }

  return null;
}

function collectToolSteps(messages: UIMessage[]) {
  const steps: ToolStep[] = [];
  for (const message of messages) {
    message.parts.forEach((part, index) => {
      if (part.type === "step-start") {
        steps.push({
          id: `${message.id}-step-${index}`,
          label: `Step ${steps.length + 1}`,
          state: "started",
          payload: null,
          isError: false,
        });
      }
      if (isToolPart(part)) {
        steps.push(stepFromPart(part, index, message.id));
      }
    });
  }
  return steps;
}

function stepFromPart(
  part: UIMessage["parts"][number],
  index: number,
  messageId = "message",
): ToolStep {
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
  return {
    id: String(record.toolCallId ?? `${messageId}-tool-${index}`),
    label,
    state,
    payload,
    isError: state === "output-error" || state === "output-denied",
  };
}

function isToolPart(part: UIMessage["parts"][number]) {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function humanizeToolState(state: string) {
  return state.replaceAll("-", " ");
}

function createConversation(): StoredConversation {
  const now = Date.now();
  return {
    id: `admin-ai-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: "New thread",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function loadConversations() {
  if (typeof window === "undefined") {
    return [createConversation()];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [createConversation()];
    }
    const parsed = JSON.parse(raw) as StoredConversation[];
    const valid = Array.isArray(parsed)
      ? parsed
          .filter((conversation) => {
            return (
              conversation &&
              typeof conversation.id === "string" &&
              typeof conversation.title === "string" &&
              Array.isArray(conversation.messages)
            );
          })
          .map((conversation) => ({
            ...conversation,
            createdAt:
              typeof conversation.createdAt === "number"
                ? conversation.createdAt
                : Date.now(),
            updatedAt:
              typeof conversation.updatedAt === "number"
                ? conversation.updatedAt
                : Date.now(),
          }))
      : [];
    return valid.length > 0 ? valid : [createConversation()];
  } catch {
    return [createConversation()];
  }
}

function saveConversations(conversations: StoredConversation[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(conversations.slice(0, MAX_STORED_THREADS)),
  );
}

function titleFromMessages(messages: UIMessage[], fallback: string) {
  const firstUserText = messages
    .find((message) => message.role === "user")
    ?.parts.find((part) => part.type === "text");
  if (!firstUserText || firstUserText.type !== "text") {
    return fallback || "New thread";
  }
  const compact = firstUserText.text.replace(/\s+/g, " ").trim();
  return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact;
}

function formatThreadDate(value: number) {
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "recent";
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
