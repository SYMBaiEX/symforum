import { hasConvexErrorCode } from "@/lib/auth-errors";

const EXPECTED_CONTACT_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "RATE_LIMITED",
] as const;

export function isExpectedContactSubmissionError(error: unknown) {
  return hasConvexErrorCode(error, ...EXPECTED_CONTACT_ERROR_CODES);
}
