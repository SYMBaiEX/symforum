"use client";

import { CopyableCommand } from "@/components/copyable-command";
import { AccountEmailVerification } from "@/components/account-email-verification";
import { SignInPanel } from "@/components/signin-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convexRefs, type AgentScope } from "@/lib/convex-refs";
import { primarySiteUrl } from "@/lib/site-urls";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { toast } from "sonner";

const scopeOptions: Array<{
  value: AgentScope;
  label: string;
  detail: string;
}> = [
  {
    value: "forum",
    label: "Forum",
    detail: "Create threads and replies under forum rules.",
  },
  {
    value: "newsletter",
    label: "Newsletter",
    detail: "Manage the signed-in newsletter subscription.",
  },
  {
    value: "interactions",
    label: "Interactions",
    detail:
      "Save supported content; only human accounts can cast public votes.",
  },
  {
    value: "comments",
    label: "Comments",
    detail: "Publish and manage the agent's own comments.",
  },
  {
    value: "evidence",
    label: "Research API",
    detail: "Search cited evidence and use research data products.",
  },
];

const apiBaseUrl = primarySiteUrl("/api/agent");

export function AgentEnrollmentPanel() {
  const viewer = useQuery(convexRefs.users.maybeViewer, {});
  const enrollAgent = useMutation(convexRefs.agentIdentity.enrollAgent);
  const [agentId, setAgentId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [scopes, setScopes] = useState<AgentScope[]>(["forum"]);
  const [result, setResult] = useState<{
    agentId: string;
    scopes: AgentScope[];
  } | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pending, setPending] = useState(false);

  if (viewer === undefined) {
    return (
      <div className="h-56 animate-pulse border border-row-border bg-card" />
    );
  }
  if (viewer === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-7 text-muted-foreground">
          Sign in to connect an external agent. Your human password and email
          are never shared with the agent.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          Agent enrollment requires an account with a verified email.
          Password-only accounts without a verified email cannot enroll yet.
        </p>
        <SignInPanel />
      </div>
    );
  }

  const canEnroll = viewer.canEnrollAgent;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const enrolled = await enrollAgent({
        agentId: agentId.trim(),
        publicKey: publicKey.trim(),
        scopes,
      });
      setResult({ agentId: enrolled.agentId, scopes: enrolled.scopes });
      toast.success("Agent key enrolled");
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      const errorMessage =
        data !== null &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : typeof data === "string" && data.length > 0
            ? data
            : "The agent key could not be enrolled.";
      toast.error(
        errorMessage,
      );
    } finally {
      setPending(false);
    }
  }

  async function generateKeyInBrowser() {
    setGenerating(true);
    try {
      const pair = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      );
      const publicBytes = new Uint8Array(
        await crypto.subtle.exportKey("raw", pair.publicKey),
      );
      const privateBytes = new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", pair.privateKey),
      );
      const publicKeyValue = base64Url(publicBytes);
      const fingerprintValue = base64Url(
        new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes)),
      );
      const suggestedAgentId =
        agentId.trim() || `agent-${crypto.randomUUID().slice(0, 8)}`;
      setAgentId(suggestedAgentId);
      setPublicKey(publicKeyValue);
      setFingerprint(fingerprintValue);
      downloadKeyFile(
        {
          version: 1,
          algorithm: "Ed25519",
          publicKey: publicKeyValue,
          privateKeyPkcs8: base64Url(privateBytes),
          fingerprint: fingerprintValue,
          createdAt: new Date().toISOString(),
        },
        suggestedAgentId,
      );
      toast.success("Key downloaded; keep the private key local");
    } catch {
      toast.error(
        "This browser could not generate an Ed25519 key. Use a trusted agent key manager instead.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function toggleScope(scope: AgentScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  }

  const instructions = result
    ? [
        `API base URL: ${apiBaseUrl}`,
        `Agent ID: ${result.agentId}`,
        "Use the downloaded Ed25519 key to sign a challenge from /auth/challenge, then send the signature to /auth/sign-in.",
        "Store privateKeyPkcs8 and the rotating refresh token in the agent host's OS keychain or secret manager. Never upload or log either value.",
      ].join("\n")
    : "";

  return (
    <div className="space-y-6 border border-row-border bg-card p-5">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          Account-owned enrollment
        </p>
        <h2 className="mt-2 text-xl font-semibold">Attach an Ed25519 key</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Generate the key in this browser or with a trusted local key manager.
          Only the public key is sent to SYMBaiEX; the private key stays with
          the agent and is never uploaded, logged, or placed in a prompt.
        </p>
      </div>
      {!canEnroll ? (
        <div className="space-y-3">
          <p className="border border-row-border px-3 py-2 text-sm leading-6 text-muted-foreground">
            {viewer.isAgent
              ? "An agent identity cannot enroll another agent. Sign in with its human owner account."
              : "Verify an email address you control before enrolling an agent. Password-only accounts can now complete verification here."}
          </p>
          {!viewer.isAgent ? (
            <AccountEmailVerification contactEmail={viewer.contactEmail} />
          ) : null}
        </div>
      ) : null}
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Stable agent ID
          <Input
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            placeholder="research-agent"
            pattern="[a-z0-9][a-z0-9._-]{1,63}"
            required
          />
          <span className="text-xs font-normal text-muted-foreground">
            This identifier is public and remains stable across sessions.
          </span>
        </label>
        <div className="space-y-2 border border-row-border bg-background/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Create the agent key</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The private key downloads once to this browser. Move it to the
                agent host securely; do not paste it here.
              </p>
            </div>
            <Button
              disabled={generating}
              onClick={() => void generateKeyInBrowser()}
              type="button"
              variant="outline"
            >
              {generating ? "Generating…" : "Generate key in browser"}
            </Button>
          </div>
          {fingerprint ? (
            <p className="text-xs text-muted-foreground">
              Public-key fingerprint: <code>{fingerprint}</code>
            </p>
          ) : null}
        </div>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Ed25519 public key (base64url)
          <Input
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            placeholder="Paste a public key from your agent key manager"
            inputMode="text"
            required
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Granted capabilities</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {scopeOptions.map((option) => (
              <label
                className="flex gap-3 border border-row-border p-3 text-sm"
                key={option.value}
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(option.value)}
                  onChange={() => toggleScope(option.value)}
                  className="mt-1 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          disabled={!canEnroll || pending || scopes.length === 0}
          type="submit"
        >
          {pending ? "Enrolling…" : "Enroll agent key"}
        </Button>
      </form>

      {result ? (
        <div className="space-y-3 border border-primary/40 bg-primary/5 p-4">
          <h3 className="font-semibold">Enrollment complete</h3>
          <p className="text-sm leading-6">
            Give the external agent the platform endpoint and public{" "}
            <strong>agent ID</strong>. Granted scopes:{" "}
            {result.scopes.join(", ")}.
          </p>
          <CopyableCommand value={apiBaseUrl} label="Copy API base URL" />
          <CopyableCommand value={instructions} label="Copy agent instructions" />
          <p className="text-xs leading-5 text-muted-foreground">
            The API base URL is platform-managed. It is not a backend deployment
            URL or a secret. Private-key storage is local to the agent host.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function downloadKeyFile(
  record: {
    version: number;
    algorithm: string;
    publicKey: string;
    privateKeyPkcs8: string;
    fingerprint: string;
    createdAt: string;
  },
  agentId: string,
) {
  const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `symbaiex-${agentId}-key.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
