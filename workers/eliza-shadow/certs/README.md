# Supabase public root CA

`supabase-root-2021.crt` is a public trust certificate, not a private key or credential. It is copied to `/app/certs/supabase-root-2021.crt` in the container. Configure the database URL with `sslmode=verify-full&sslrootcert=/app/certs/supabase-root-2021.crt`. The local one-time bootstrap URL must reference the equivalent absolute local path instead.

Provenance: Supabase Studio's [`ssl:certificate_url` configuration](https://github.com/supabase/supabase/blob/e854b84ed4517b0f21a1acd0a0abdd8a8d5cb9a7/apps/studio/hooks/custom-content/custom-content.json) points to [the official production CA download](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt). Downloaded over HTTPS and checked on 2026-10-20.

- Subject/issuer: `Supabase Root 2021 CA`, Supabase Inc.
- Validity: 2021-04-28 10:56:53 UTC through 2031-04-26 10:56:53 UTC.
- SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Do not replace certificate verification with `rejectUnauthorized:false` or disable TLS checks. Rotate this public trust asset only after verifying Supabase's current official source and fingerprint; the test suite pins its identity.
