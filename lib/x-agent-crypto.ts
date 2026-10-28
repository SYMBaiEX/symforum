function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
export function randomXSecret() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function xHash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function pkceChallenge(verifier: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64(new Uint8Array(hash))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
async function key(kek: string) {
  if (!/^[a-f0-9]{64}$/.test(kek))
    throw Error("X credential encryption is not configured.");
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(kek.match(/../g)!, (x) => parseInt(x, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
/** AAD prevents swapping encrypted grants between agents, owners or purposes. */
export async function sealX(kek: string, plaintext: string, binding: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(binding) },
    await key(kek),
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: base64(new Uint8Array(ciphertext)), nonce: base64(iv) };
}
export async function unsealX(
  kek: string,
  sealed: { ciphertext: string; nonce: string },
  binding: string,
) {
  const bytes = (s: string) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
  const value = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes(sealed.nonce),
      additionalData: new TextEncoder().encode(binding),
    },
    await key(kek),
    bytes(sealed.ciphertext),
  );
  return new TextDecoder().decode(value);
}
