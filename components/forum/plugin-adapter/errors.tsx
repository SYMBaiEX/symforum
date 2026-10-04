import { Toaster, toast } from "sonner";
export function AppErrorSurface() {
  return <Toaster theme="system" richColors />;
}
export function reportAppError(error: unknown) {
  toast.error(
    error instanceof Error ? error.message : "The forum request failed.",
  );
}
