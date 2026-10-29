// Opt-in, local-only diagnostics. Never retain provider bodies, wallet addresses,
// challenges, signatures, messages, session identifiers, or network payloads.
type Stage =
  | "selected"
  | "connect_requested"
  | "connect_succeeded"
  | "existing_account_selected"
  | "challenge_requested"
  | "challenge_ready"
  | "signature_requested"
  | "signature_succeeded"
  | "proof_requested"
  | "proof_verified"
  | "session_confirmed"
  | "failed";
type Phase = "connect" | "prepare" | "sign" | "verify" | "session";
type Fields = {
  accountCount?: number;
  canSignMessage?: boolean;
  canSignIn?: boolean;
  sdkStatus?: string;
};
export type WalletDiagnostic = Readonly<{
  attempt: number;
  elapsedMs: number;
  wallet: "Phantom" | "Solflare" | "MetaMask" | "Other";
  lane: "minimal" | "signin" | "provider";
  stage: Stage;
  userActivated: boolean;
  visible: boolean;
  secureContext: boolean;
  topLevel: boolean;
  accountCount?: number;
  canSignMessage?: boolean;
  canSignIn?: boolean;
  sdkStatus?: "pending" | "disconnected" | "connecting" | "connected";
  phase?: Phase;
  errorCode?: number;
}>;
const empty: readonly WalletDiagnostic[] = Object.freeze([]);
let records = empty;
let nextAttempt = 0;
const listeners = new Set<() => void>();

export function walletDiagnosticsEnabled() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("walletDebug") === "1"
  );
}
export const getWalletDiagnostics = () => records;
export const subscribeWalletDiagnostics = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function clearWalletDiagnostics() {
  records = empty;
  for (const listener of listeners) listener();
}

export function createWalletDiagnostic(
  name: string,
  lane: "minimal" | "signin" | "provider" = "signin",
) {
  const enabled = walletDiagnosticsEnabled();
  const attempt = enabled ? ++nextAttempt : 0;
  const started = performance.now();
  const wallet =
    name === "Phantom" || name === "Solflare" || name === "MetaMask"
      ? name
      : "Other";
  function append(
    stage: Stage,
    fields: Fields = {},
    failure?: { phase: Phase; errorCode?: number },
  ) {
    if (!enabled) return;
    // Reconstruct an explicit allowlist, even if a caller passes extra fields.
    const entry: WalletDiagnostic = Object.freeze({
      attempt,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      wallet,
      lane,
      stage,
      userActivated: navigator.userActivation?.isActive === true,
      visible: document.visibilityState === "visible",
      secureContext: window.isSecureContext === true,
      topLevel: window.top === window,
      ...(typeof fields.accountCount === "number" &&
      Number.isFinite(fields.accountCount)
        ? {
            accountCount: Math.max(
              0,
              Math.min(100, Math.floor(fields.accountCount)),
            ),
          }
        : {}),
      ...(typeof fields.canSignMessage === "boolean"
        ? { canSignMessage: fields.canSignMessage }
        : {}),
      ...(typeof fields.canSignIn === "boolean"
        ? { canSignIn: fields.canSignIn }
        : {}),
      ...(["pending", "disconnected", "connecting", "connected"].includes(
        fields.sdkStatus ?? "",
      )
        ? { sdkStatus: fields.sdkStatus as WalletDiagnostic["sdkStatus"] }
        : {}),
      ...failure,
    });
    records = Object.freeze([...records.slice(-99), entry]);
    // Diagnostics must never change wallet behavior if a console/listener fails.
    try {
      console.info("[SYMBaiEX wallet]", entry);
    } catch {
      /* local diagnostics only */
    }
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* local diagnostics only */
      }
    }
  }
  return {
    record: (stage: Stage, fields?: Fields) => append(stage, fields),
    failure(phase: Phase, reason: unknown) {
      let errorCode: number | undefined;
      try {
        // Some SDK boundaries preserve an extension error in cause.
        let current = reason;
        for (
          let depth = 0;
          depth < 3 && current && typeof current === "object";
          depth++
        ) {
          if (
            "code" in current &&
            typeof current.code === "number" &&
            Number.isSafeInteger(current.code) &&
            Math.abs(current.code) < 1_000_000
          ) {
            errorCode = current.code;
            break;
          }
          current = "cause" in current ? current.cause : undefined;
        }
      } catch {
        /* Untrusted extension getters are not diagnostic data. */
      }
      append(
        "failed",
        {},
        { phase, ...(errorCode === undefined ? {} : { errorCode }) },
      );
    },
  };
}
export type WalletDiagnosticAttempt = ReturnType<typeof createWalletDiagnostic>;
