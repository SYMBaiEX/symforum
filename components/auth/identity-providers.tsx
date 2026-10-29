"use client";
import { useEffect, useState } from "react";
import { getWallets } from "@wallet-standard/app";
import { Button } from "@/components/ui/button";
import {
  identityClient,
  identityRequest,
} from "@symbaiex/auth/identity-client";
import type { walletLoginInput } from "@/lib/human-auth-proof";

type Challenge = {
  nonce: string;
  input?: ReturnType<typeof walletLoginInput>;
  clientId?: string;
};
type WalletProof = {
  account: { address: string; publicKey: Uint8Array };
  signedMessage: Uint8Array;
  signature: Uint8Array;
};
type SignInFeature = {
  signIn: (
    input: ReturnType<typeof walletLoginInput>,
  ) => Promise<WalletProof[]>;
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
function encoded(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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
  const [walletNames, setWalletNames] = useState<string[]>([]);
  const [telegram, setTelegram] = useState<Challenge | null>(null);
  const [telegramReady, setTelegramReady] = useState(false);
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://oauth.telegram.org/js/telegram-login.js?6";
    script.async = true;
    script.nonce =
      document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    script.onload = () => setTelegramReady(true);
    script.onerror = () => setTelegramReady(false);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);
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
  async function wallet(name: string) {
    const selected = getWallets()
      .get()
      .find(
        (wallet) => wallet.name === name && "solana:signIn" in wallet.features,
      );
    if (!selected)
      throw new Error("Choose a wallet that supports Sign In With Solana.");
    const challenge = await identityRequest<Challenge>("/identity/challenge", {
      provider: "solana",
      purpose,
    });
    if (!challenge.input) throw new Error("Restart wallet verification.");
    const feature = selected.features["solana:signIn"] as SignInFeature;
    const [proof] = await feature.signIn(challenge.input);
    if (!proof) throw new Error("Wallet verification was cancelled.");
    await identityRequest("/sign-in/solana", {
      nonce: challenge.nonce,
      address: proof.account.address,
      publicKey: encoded(proof.account.publicKey),
      signature: encoded(proof.signature),
      signedMessage: encoded(proof.signedMessage),
    });
    await identityClient.getSession();
    onComplete();
  }
  return (
    <div className="space-y-3">
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
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            const names = getWallets()
              .get()
              .filter((wallet) => "solana:signIn" in wallet.features)
              .map((wallet) => wallet.name);
            setWalletNames(names);
            if (!names.length)
              setError(
                "Install or open a Solana wallet that supports Sign In With Solana.",
              );
          }}
        >
          {purpose === "link" ? "Link wallet" : "Solana wallet"}
        </Button>
      </div>
      {walletNames.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Choose a wallet">
          {walletNames.map((name) => (
            <Button
              key={name}
              variant="secondary"
              disabled={pending}
              onClick={() => void attempt(() => wallet(name))}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        className="w-full"
        disabled={pending || !telegramReady}
        onClick={() => {
          if (!telegram) {
            void attempt(async () =>
              setTelegram(
                await identityRequest<Challenge>("/identity/challenge", {
                  provider: "telegram",
                  purpose,
                }),
              ),
            );
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
                await identityClient.getSession();
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
