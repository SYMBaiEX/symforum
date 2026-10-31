"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/swap-amounts";
import {
  MAX_PROMOTION_SELECTIONS,
  overlapsPromotion,
} from "@/lib/promotion-calendar";
import { ChevronLeft, ChevronRight } from "lucide-react";

const dayKey = (timestamp: number) => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthKey = (timestamp: number) => dayKey(timestamp).slice(0, 7);
const fullDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(timestamp);
const time = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(timestamp);

export function PromotionCalendar({
  threadId,
  onReserve,
  disabled,
  busy,
  enabled,
}: {
  threadId: Id<"forumThreads">;
  enabled: boolean;
  onReserve: (starts: number[], categoryId: Id<"forumCategories">) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const [minute, setMinute] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const [expandedDay, setExpandedDay] = useState("");
  const [selection, updateSelection] = useState<{
    categoryId: Id<"forumCategories">;
    starts: number[];
  } | null>(null);
  useEffect(() => {
    const tick = () => setMinute(Math.floor(Date.now() / 60_000));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  const calendar = useQuery(
    api.forumPromotions.calendar,
    minute === null || !enabled ? "skip" : { threadId, minute },
  );
  if (calendar === undefined)
    return <p role="status">Loading available promotion times…</p>;
  if (calendar === null)
    return <p role="status">Promotion times are currently unavailable.</p>;
  const selected =
    selection?.categoryId === calendar.categoryId ? selection.starts : [];
  const setSelected = (update: (current: number[]) => number[]) =>
    updateSelection((current) => ({
      categoryId: calendar.categoryId,
      starts: update(
        current?.categoryId === calendar.categoryId ? current.starts : [],
      ),
    }));
  const slots = calendar.slots;
  const byDay = new Map<string, typeof slots>();
  for (const slot of slots) {
    const key = dayKey(slot.startsAt);
    const list = byDay.get(key) ?? [];
    list.push(slot);
    byDay.set(key, list);
  }
  const days = [...byDay.keys()];
  const months = [...new Set(slots.map((s) => monthKey(s.startsAt)))];
  const activeMonth = months.includes(month) ? month : months[0];
  if (!activeMonth)
    return (
      <p role="status">No available promotion times in the next seven days.</p>
    );
  const [year, monthNumber] = activeMonth.split("-").map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const cells = Array.from(
    { length: new Date(year, monthNumber, 0).getDate() },
    (_, i) => new Date(year, monthNumber - 1, i + 1),
  );
  const activeDay =
    days.includes(expandedDay) && expandedDay.startsWith(activeMonth)
      ? expandedDay
      : days.find((d) => d.startsWith(activeMonth));
  const selectedSlots = selected.map((start) =>
    slots.find((s) => s.startsAt === start),
  );
  const valid =
    selected.length > 0 && selectedSlots.every((s) => s && s.remaining > 0);
  const total = String(BigInt(calendar.amountRaw) * BigInt(selected.length));
  const previous = months[months.indexOf(activeMonth) - 1];
  const next = months[months.indexOf(activeMonth) + 1];
  return (
    <div className="promotion-calendar">
      <p>
        Choose up to {MAX_PROMOTION_SELECTIONS} placements in the next seven
        days. Each lasts {calendar.durationMs / 3_600_000} hours. Times use your
        local time zone.
      </p>
      <div className="promotion-calendar-heading">
        <Button
          type="button"
          variant="ghost"
          aria-label="Previous month"
          disabled={!previous || busy}
          onClick={() => setMonth(previous)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <strong>
          {new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric",
          }).format(monthStart)}
        </strong>
        <Button
          type="button"
          variant="ghost"
          aria-label="Next month"
          disabled={!next || busy}
          onClick={() => setMonth(next)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <fieldset disabled={busy}>
        <legend className="sr-only">Choose a promotion day</legend>
        <div className="promotion-calendar-days">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <span key={d} aria-hidden="true">
              {d}
            </span>
          ))}
          {Array.from({ length: monthStart.getDay() }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {cells.map((date) => {
            const key = dayKey(date.getTime());
            const available = slots.some(
              (s) => dayKey(s.startsAt) === key && s.remaining > 0,
            );
            const count = selected.filter((s) => dayKey(s) === key).length;
            return (
              <button
                key={key}
                type="button"
                disabled={!days.includes(key) || (!available && !count)}
                aria-label={`${fullDate(date.getTime())}${count ? `, ${count} selected` : ""}`}
                aria-pressed={activeDay === key}
                onClick={() => setExpandedDay(key)}
              >
                {date.getDate()}
                {count > 0 && (
                  <span className="promotion-calendar-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="promotion-calendar-times" disabled={busy}>
        <legend>
          Start times ·{" "}
          {activeDay
            ? fullDate(new Date(`${activeDay}T12:00:00`).getTime())
            : "Choose a day"}
        </legend>
        <div className="promotion-calendar-time-grid">
          {slots
            .filter((s) => dayKey(s.startsAt) === activeDay)
            .map((slot) => {
              const checked = selected.includes(slot.startsAt);
              const clashes = selected.some((start) =>
                overlapsPromotion(slot, {
                  startsAt: start,
                  endsAt: start + calendar.durationMs,
                }),
              );
              const blocked =
                !checked &&
                (!slot.remaining ||
                  selected.length >= MAX_PROMOTION_SELECTIONS ||
                  clashes);
              return (
                <label
                  key={slot.startsAt}
                  className={blocked ? "is-unavailable" : ""}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={blocked}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(slot.startsAt)
                          ? current.filter((s) => s !== slot.startsAt)
                          : current.length >= MAX_PROMOTION_SELECTIONS ||
                              current.some((start) =>
                                overlapsPromotion(slot, {
                                  startsAt: start,
                                  endsAt: start + calendar.durationMs,
                                }),
                              )
                            ? current
                            : [...current, slot.startsAt].sort((a, b) => a - b),
                      )
                    }
                  />
                  <span>
                    {time(slot.startsAt)}
                    <small>
                      {!slot.remaining
                        ? "Fully booked"
                        : clashes && !checked
                          ? "Overlaps selection"
                          : `${slot.remaining} available`}
                    </small>
                  </span>
                </label>
              );
            })}
        </div>
      </fieldset>
      {selected.length > 0 && (
        <div className="promotion-calendar-selection" aria-live="polite">
          <strong>
            {selected.length} selected ·{" "}
            {formatTokenAmount(total, calendar.decimals)} SYMF total
          </strong>
          <ul>
            {selected.map((start) => (
              <li key={start}>
                {fullDate(start)}, {time(start)}{" "}
                <button
                  type="button"
                  aria-label={`Remove ${fullDate(start)} at ${time(start)}`}
                  disabled={busy}
                  onClick={() =>
                    setSelected((current) => current.filter((s) => s !== start))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {!valid && (
            <p role="status">
              A selected time is no longer available. Remove it and choose
              another.
            </p>
          )}
        </div>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={disabled || busy || !valid}
        onClick={() => onReserve(selected, calendar.categoryId)}
      >
        {busy ? "Reserving selected times…" : "Reserve selected slots"}
      </Button>
      <p className="commerce-note">
        Selecting dates is free. Times are held only after reservation; payment
        still requires your wallet approval.
      </p>
    </div>
  );
}
