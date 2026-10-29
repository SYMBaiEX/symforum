/** Explicit public-key projection. Never forward private JWK material. */
export function publicIdentityKeys(...sets: unknown[]) {
  const keys = new Map<
    string,
    { kty: string; kid: string; n: string; e: string; alg: string; use: string }
  >();
  for (const set of sets) {
    if (
      !set ||
      typeof set !== "object" ||
      !("keys" in set) ||
      !Array.isArray(set.keys)
    )
      continue;
    for (const key of set.keys) {
      if (
        !key ||
        typeof key !== "object" ||
        key.kty !== "RSA" ||
        typeof key.kid !== "string" ||
        typeof key.n !== "string" ||
        typeof key.e !== "string" ||
        (key.alg && key.alg !== "RS256")
      )
        continue;
      const prior = keys.get(key.kid);
      if (prior && (prior.n !== key.n || prior.e !== key.e))
        throw new Error("Conflicting signing key identifiers.");
      keys.set(key.kid, {
        kty: "RSA",
        kid: key.kid,
        n: key.n,
        e: key.e,
        alg: "RS256",
        use: "sig",
      });
    }
  }
  return { keys: [...keys.values()] };
}
