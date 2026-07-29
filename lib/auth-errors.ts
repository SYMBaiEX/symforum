export function isAuthRequiredError(error: unknown) {
  const data = convexErrorData(error);
  const code =
    typeof data === "object" && data !== null && "code" in data
      ? String(data.code)
      : "";
  const message = errorMessage(error);

  if (/^(AUTH_REQUIRED|UNAUTHENTICATED|NOT_AUTHENTICATED)$/i.test(code)) {
    return true;
  }
  if (
    /^(FORUM_TRUST_REQUIRED|UNAUTHORIZED)$/i.test(code) ||
    /forum approval|forum posting access|forum reply access|forum voting access|forum edit access/i.test(
      message,
    )
  ) {
    return false;
  }

  return /not authenticated|sign in|required auth/i.test(message);
}

export function userFacingError(error: unknown, fallback: string) {
  return errorMessage(error) || fallback;
}

export function convexErrorCode(error: unknown) {
  const data = convexErrorData(error);
  if (
    typeof data !== "object" ||
    data === null ||
    !("code" in data) ||
    typeof data.code !== "string"
  ) {
    return null;
  }
  const code = data.code.trim();
  return code.length > 0 ? code : null;
}

export function hasConvexErrorCode(
  error: unknown,
  ...expectedCodes: readonly string[]
) {
  const code = convexErrorCode(error)?.toUpperCase();
  if (!code) {
    return false;
  }
  return expectedCodes.some(
    (expectedCode) => expectedCode.toUpperCase() === code,
  );
}

function errorMessage(error: unknown) {
  const data = convexErrorData(error);
  if (typeof data === "string" && data.trim().length > 0) {
    return data;
  }
  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string" &&
    data.message.trim().length > 0
  ) {
    return data.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "";
}

function convexErrorData(error: unknown) {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return null;
  }
  return (error as { data?: unknown }).data ?? null;
}
