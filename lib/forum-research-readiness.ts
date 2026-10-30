import { record } from "./forum-commerce";
import {
  RESEARCH_CREDIT_RESERVE,
  RESEARCH_NETWORK,
  RESEARCH_READINESS_TTL,
} from "./forum-research";

/** Fail closed if the current/upcoming rate cannot fit the permanently reserved free credits. */
export function researchRateWithinReserve(supported: unknown, now: number) {
  const pricing = record(record(supported).pricing),
    rates = pricing.rates,
    upcoming = pricing.upcoming;
  if (
    !Array.isArray(rates) ||
    rates.length > 128 ||
    !Array.isArray(upcoming) ||
    upcoming.length > 128
  )
    return false;
  const matching = (entry: Record<string, unknown>) =>
    entry.network === RESEARCH_NETWORK &&
    entry.scheme === "exact" &&
    entry.transferMethod === "svm_transfer";
  const valid = (entry: Record<string, unknown>) =>
    typeof entry.credits === "string" &&
    /^\d+(\.\d{1,8})?$/.test(entry.credits) &&
    Number(entry.credits) > 0 &&
    Number(entry.credits) <= RESEARCH_CREDIT_RESERVE;
  const current = rates
    .map(record)
    .filter(matching)
    .sort(
      (a, b) =>
        Date.parse(String(b.effectiveAt)) - Date.parse(String(a.effectiveAt)),
    )[0];
  if (
    !current ||
    !valid(current) ||
    !Number.isFinite(Date.parse(String(current.effectiveAt))) ||
    Date.parse(String(current.effectiveAt)) > now
  )
    return false;
  return upcoming
    .map(record)
    .filter(matching)
    .every((entry) => {
      const effective = Date.parse(String(entry.effectiveAt));
      return (
        Number.isFinite(effective) &&
        (effective > now + RESEARCH_READINESS_TTL || valid(entry))
      );
    });
}
