/** Only known local amount-parser messages may be shown beside the input. */
export function swapAmountIssue(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "";
  if (
    /^This token supports at most (?:[0-9]|1[0-8]) decimal places\.$/.test(
      message,
    )
  )
    return message;
  if (message === "Amount is out of range.")
    return "Enter an amount greater than zero within this token's supported range.";
  return "Enter a positive decimal amount, without commas or an exponent.";
}

export function swapAmountHelp(symbol?: string, decimals?: number): string {
  if (
    !symbol ||
    !Number.isInteger(decimals) ||
    decimals == null ||
    decimals < 0 ||
    decimals > 18
  )
    return "Choose a pay token to see its supported decimal precision.";
  return `Enter a positive ${symbol} amount with at most ${decimals} decimal places. Extra decimals are rejected, never rounded.`;
}
