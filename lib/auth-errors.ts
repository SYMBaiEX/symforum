export function isAuthRequiredError(error: unknown) {
  const data = convexErrorData(error);
  const code =
    typeof data === "object" && data !== null && "code" in data
      ? String(data.code)
      : "";
  const message = errorMessage(error);

  return (
    /auth|required|unauthorized/i.test(code) ||
    /not authenticated|unauthorized|sign in|required auth/i.test(message)
  );
}

export function userFacingError(error: unknown, fallback: string) {
  return errorMessage(error) || fallback;
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
