"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WalletSignIn } from "./wallet-signin";
import {
  identityClient,
  identityRequest,
  refreshIdentitySession,
} from "@symbaiex/auth/identity-client";

type Challenge = {
  nonce: string;
  expiresAt: number;
  clientId?: string;
};
type TelegramLogin = {
  auth: (
    options: { client_id: number; nonce: string; scope: string[] },
    callback: (data: { id_token?: string; error?: string }) => void,
  ) => void;
};
function telegramLogin() {
  return (window as Window & { Telegram?: { Login?: TelegramLogin } }).Telegram
    ?.Login;
}
let telegramSdk: Promise<TelegramLogin> | null = null;
function loadTelegramLogin() {
  const existing = telegramLogin();
  if (existing) return Promise.resolve(existing);
  if (telegramSdk) return telegramSdk;
  telegramSdk = new Promise<TelegramLogin>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://oauth.telegram.org/js/telegram-login.js?6";
    script.async = true;
    script.nonce =
      document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    const failed = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error("Telegram login could not load. Please try again."));
    };
    const timeout = setTimeout(failed, 15_000);
    script.onerror = failed;
    script.onload = () => {
      const login = telegramLogin();
      if (!login) return failed();
      clearTimeout(timeout);
      resolve(login);
    };
    document.head.appendChild(script);
  }).catch((reason) => {
    telegramSdk = null;
    throw reason;
  });
  return telegramSdk;
}

export function IdentityProviders({
  purpose = "login",
  onComplete,
  returnTo = "/",
}: {
  purpose?: "login" | "link";
  onComplete: () => void;
  returnTo?: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [telegram, setTelegram] = useState<Challenge | null>(null);
  async function attempt(task: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await task();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Verification did not complete.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            void attempt(async () => {
              const result =
                purpose === "link"
                  ? await identityClient.linkSocial({
                      provider: "google",
                      callbackURL: window.location.href,
                    })
                  : await identityClient.signIn.social({
                      provider: "google",
                      callbackURL: window.location.origin + returnTo,
                    });
              if (result.error)
                throw new Error("Google sign-in could not be started.");
            })
          }
        >
          {purpose === "link" ? "Link Google" : "Continue with Google"}
        </Button>
        <WalletSignIn
          purpose={purpose}
          disabled={pending}
          onBusyChange={setPending}
          onComplete={onComplete}
        />
      </div>
      <Button
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() => {
          if (!telegram || telegram.expiresAt <= Date.now() + 5_000) {
            void attempt(async () => {
              await loadTelegramLogin();
              setTelegram(
                await identityRequest<Challenge>("/identity/challenge", {
                  provider: "telegram",
                  purpose,
                }),
              );
            });
            return;
          }
          const login = telegramLogin();
          if (!login || !telegram.clientId) {
            setError("Telegram login is not configured.");
            return;
          }
          login.auth(
            {
              client_id: Number(telegram.clientId),
              nonce: telegram.nonce,
              scope: ["profile"],
            },
            (result) => {
              void attempt(async () => {
                if (!result.id_token)
                  throw new Error("Telegram verification was cancelled.");
                await identityRequest("/sign-in/telegram", {
                  nonce: telegram.nonce,
                  idToken: result.id_token,
                });
                setTelegram(null);
                await refreshIdentitySession();
                onComplete();
              });
            },
          );
        }}
      >
        {telegram
          ? "Continue with Telegram"
          : purpose === "link"
            ? "Link Telegram"
            : "Telegram"}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        Wallet sign-in requests a message signature, never a transaction or
        spending approval. Telegram requests profile access only.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
