import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { WalletSignIn } from "../../components/auth/wallet-signin";
import {
  createIdentityWalletClient,
  type IdentityWalletClient,
} from "../../lib/identity-wallet-client";
import {
  createWalletDiagnostic,
  getWalletDiagnostics,
  subscribeWalletDiagnostics,
  clearWalletDiagnostics,
} from "../../lib/wallet-diagnostics";

function Minimal({
  client,
  onBusyChange,
}: {
  client: IdentityWalletClient;
  onBusyChange: (busy: boolean) => void;
}) {
  const state = useSyncExternalStore(
    client.wallet.subscribe,
    client.wallet.getState,
  );
  const [result, setResult] = useState("");
  const inFlight = useRef(false);
  return (
    <>
      <h2>Minimal Kit connection</h2>
      <p>
        No auth provider, server challenge, signature request, or account
        creation.
      </p>
      {state.wallets.map((wallet, index) => (
        <button
          key={index}
          disabled={state.status === "connecting"}
          onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            onBusyChange(true);
            setResult("");
            const report = createWalletDiagnostic(wallet.name, "minimal");
            report.record("selected", {
              accountCount: wallet.accounts.length,
              sdkStatus: state.status,
            });
            try {
              report.record("connect_requested");
              const accounts = await client.wallet.connect(wallet);
              report.record("connect_succeeded", {
                accountCount: accounts.length,
                sdkStatus: client.wallet.getState().status,
              });
              setResult("Connected locally. No signature or login requested.");
            } catch (reason) {
              report.failure("connect", reason);
              setResult(
                "Connection failed. See the safe diagnostic log below.",
              );
            } finally {
              inFlight.current = false;
              onBusyChange(false);
            }
          }}
        >
          Connect {wallet.name}
        </button>
      ))}
      {state.status !== "pending" && state.wallets.length === 0 && (
        <p>No compatible extension discovered.</p>
      )}
      <p role="status">{result || state.status}</p>
    </>
  );
}

function DebugPage() {
  const [mode, setMode] = useState<"minimal" | "signin" | "provider">(
    "minimal",
  );
  const [client, setClient] = useState<IdentityWalletClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const records = useSyncExternalStore(
    subscribeWalletDiagnostics,
    getWalletDiagnostics,
  );
  useEffect(() => {
    if (mode !== "minimal") return;
    const owned = createIdentityWalletClient();
    setClient(owned);
    return () => {
      owned[Symbol.dispose]();
      setClient(null);
    };
  }, [mode]);
  return (
    <main
      style={{
        margin: "40px auto",
        maxWidth: 920,
        padding: 24,
        fontFamily: "system-ui",
        lineHeight: 1.6,
      }}
    >
      <style>{`body{background:#fafafa;color:#17202b}button{padding:12px 18px;margin:6px;border:1px solid #bbc3cf;border-radius:10px;background:white;color:#17202b;cursor:pointer}button:disabled{opacity:.5;cursor:wait}pre{background:#ecf0f5;padding:16px;border-radius:12px;font:12px/1.5 monospace;overflow:auto} [role=dialog]{position:fixed;inset:10% auto auto 25%;padding:24px;background:white;border:1px solid #aaa;max-width:500px;z-index:100} [role=dialog] button{display:block}`}</style>
      <h1>Local Solana Kit diagnostics</h1>
      <p>
        <strong>
          Local only. No production accounts, Convex requests, RPC calls,
          transactions, or persistent logs.
        </strong>
      </p>
      <p>
        Choose one mode at a time. Approve connection only for the minimal test.
        The full flow additionally asks for an explicit local-only message
        signature.
      </p>
      <nav aria-label="Diagnostic mode">
        <button
          disabled={busy || mode === "minimal"}
          onClick={() => {
            setComplete(false);
            setMode("minimal");
          }}
        >
          Minimal Kit
        </button>
        <button
          disabled={busy || mode === "signin"}
          onClick={() => {
            setComplete(false);
            setMode("signin");
          }}
        >
          Full sign-in component
        </button>
        <button
          disabled={busy || mode === "provider"}
          onClick={() => {
            setComplete(false);
            setMode("provider");
          }}
        >
          Phantom provider control
        </button>
      </nav>
      {mode === "minimal" ? (
        client && <Minimal client={client} onBusyChange={setBusy} />
      ) : mode === "provider" ? (
        <ProviderControl onBusyChange={setBusy} />
      ) : (
        <section>
          <h2>Shared production sign-in component, local verifier</h2>
          <WalletSignIn
            purpose="login"
            disabled={busy}
            onBusyChange={setBusy}
            onComplete={() => setComplete(true)}
          />
          {complete && (
            <p role="status">
              Signature verified locally. No production account or session was
              created.
            </p>
          )}
        </section>
      )}
      <h2>Safe diagnostic log</h2>
      <p>
        Only stages, counts, browser state and numeric error codes. No
        addresses, signatures, challenges, messages, sessions or raw errors.
        Maximum 100 entries; reload clears the log.
      </p>
      <button onClick={clearWalletDiagnostics}>Clear diagnostic log</button>
      <pre aria-label="Wallet diagnostics">
        {JSON.stringify(records, null, 2)}
      </pre>
    </main>
  );
}

// Local diagnostic control, not an application fallback. Uses only Phantom's
// documented Solana namespace to distinguish extension vs Wallet Standard faults.
function ProviderControl({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [result, setResult] = useState("");
  const inFlight = useRef(false);
  return (
    <section>
      <h2>Direct Phantom Solana provider control</h2>
      <p>
        No Kit client or authentication code is mounted in this mode. Connection
        only, no signature.
      </p>
      <button
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          onBusyChange(true);
          setResult("");
          const report = createWalletDiagnostic("Phantom", "provider");
          try {
            const provider = (
              window as Window & {
                phantom?: {
                  solana?: {
                    isPhantom?: boolean;
                    connect: () => Promise<{ publicKey?: unknown }>;
                  };
                };
              }
            ).phantom?.solana;
            if (!provider?.isPhantom)
              throw new Error("Phantom Solana provider unavailable.");
            report.record("connect_requested");
            const result = await provider.connect();
            if (!result.publicKey) throw new Error("No account returned.");
            report.record("connect_succeeded", { accountCount: 1 });
            setResult(
              "Phantom provider returned a connection. No signature or login requested.",
            );
          } catch (reason) {
            report.failure("connect", reason);
            setResult(
              "Direct Phantom provider connection failed. See the safe diagnostic log.",
            );
          } finally {
            inFlight.current = false;
            onBusyChange(false);
          }
        }}
      >
        Connect Phantom directly
      </button>
      <p role="status">{result}</p>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<DebugPage />);
