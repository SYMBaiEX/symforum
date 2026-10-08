export function authKitProviderProps(workosEnabled: boolean) {
  if (workosEnabled) return {};

  return {
    initialAuth: { user: null },
    onSessionExpired: false as const,
  };
}
