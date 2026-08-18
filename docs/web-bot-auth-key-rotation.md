# Web Bot Auth public-key rotation

The directory supports the existing single-key environment variables without
change. `WEB_BOT_AUTH_PRIVATE_JWK` remains secret and signs responses;
`WEB_BOT_AUTH_PUBLIC_JWK` remains the compatible public JWK source.

For an operator-controlled overlap, set `WEB_BOT_AUTH_PUBLIC_JWK_SET` to one
JSON object. Times are finite Unix milliseconds. `kid` for the `current` key
must be its JWK thumbprint, because the response signer derives that identifier.

```json
{
  "current": {
    "kty": "OKP", "crv": "Ed25519", "x": "...", "kid": "...",
    "notBefore": 1787000000000, "notAfter": 1787604800000
  },
  "retiring": {
    "kty": "OKP", "crv": "Ed25519", "x": "...", "kid": "...",
    "notBefore": 1787000000000, "notAfter": 1787604800000
  }
}
```

It accepts exactly one current key and, optionally, one public retiring key.
Both must be Ed25519 OKP JWKs with 32-byte base64url `x` values. No private
material or unrecognized fields are accepted. The configured validity windows
must overlap for no more than seven days; the current key must be valid now.
An expired retiring key is omitted from the published directory. Directory
caching is bounded by the closest published-key expiry.

Operator sequence (external steps intentionally not performed by this code):

1. Publish the valid current and retiring public key overlap, with the private
   JWK matching the current key.
2. Update the Cloudflare Signed Agent registration to include the current key.
3. Wait for Cloudflare verification before removing the old registration.
4. Retire the old public key after its overlap window ends, then remove it from
   Cloudflare registration.

The application never creates, rotates, or submits keys automatically.
