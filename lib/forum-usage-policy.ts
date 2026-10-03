export const FORUM_REQUEST_RATES = {
  read: {
    ownerPerMinute: 600,
    ownerBurst: 120,
    credentialPerMinute: 900,
    credentialBurst: 180,
  },
  write: {
    ownerPerMinute: 120,
    ownerBurst: 40,
    credentialPerMinute: 240,
    credentialBurst: 80,
  },
} as const;

export const FORUM_USAGE_POLICY = {
  scope: "forum",
  monthlyLimit: null,
  readRequestsPerMinute: FORUM_REQUEST_RATES.read.ownerPerMinute,
  writeRequestsPerMinute: FORUM_REQUEST_RATES.write.ownerPerMinute,
  ownerScoped: true,
} as const;
