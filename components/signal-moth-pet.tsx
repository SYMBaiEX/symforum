"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SignalMothAction = "failed" | "jumping" | "review" | "waiting" | "waving";

const signalMothActions: SignalMothAction[] = [
  "waving",
  "jumping",
  "waiting",
  "review",
  "failed",
];

const actionDurations: Record<SignalMothAction, number> = {
  waving: 1400,
  jumping: 1680,
  failed: 2440,
  waiting: 2020,
  review: 2060,
};

export function SignalMothPet() {
  const [action, setAction] = useState<SignalMothAction | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const lastActionRef = useRef<SignalMothAction | null>(null);

  const playAction = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    const pool = signalMothActions.filter(
      (candidate) => candidate !== lastActionRef.current,
    );
    const nextAction =
      pool[Math.floor(Math.random() * pool.length)] ?? "waving";
    lastActionRef.current = nextAction;
    setAction(nextAction);

    timeoutRef.current = window.setTimeout(() => {
      setAction(null);
      timeoutRef.current = null;
    }, actionDurations[nextAction]);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <button
      aria-label="Play Signal Moth animation"
      className={`signal-moth-track is-ready${action ? ` is-acting action-${action}` : ""}`}
      onClick={playAction}
      title="Signal Moth"
      type="button"
    >
      <span className="signal-moth-bob" aria-hidden="true">
        <span className="signal-moth-sprite signal-moth-sprite--right" />
        <span className="signal-moth-sprite signal-moth-sprite--left" />
        <span className="signal-moth-sprite signal-moth-sprite--action" />
      </span>
    </button>
  );
}
