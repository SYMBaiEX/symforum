"use client";

import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CopyableCommand({
  value,
  label = "Copy command",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label.replace(/^Copy\s+/i, "")} copied`);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error("Copy failed; select the command manually.");
    }
  }

  return (
    <div className="relative border border-row-border bg-card">
      <pre className="overflow-x-auto whitespace-pre-wrap p-4 pr-16 font-mono text-xs leading-6">
        <code>{value}</code>
      </pre>
      <Button
        aria-label={label}
        className="absolute right-2 top-2"
        onClick={() => void copy()}
        size="icon"
        type="button"
        variant="outline"
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
