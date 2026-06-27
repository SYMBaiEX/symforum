"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  convexRefs,
  type ContactRequestRecord,
  type ContactRequestStatus,
} from "@/lib/convex-refs";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ContactFilter = "all" | ContactRequestStatus;

const filters: ContactFilter[] = ["all", "new", "read", "archived"];

export function AdminContactRequests() {
  const [filter, setFilter] = useState<ContactFilter>("all");
  const requests = useQuery(
    convexRefs.admin.listContactRequests,
    filter === "all" ? {} : { status: filter },
  );
  const updateStatus = useMutation(
    convexRefs.admin.updateContactRequestStatus,
  );

  const sortedRequests = useMemo(
    () => [...(requests ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [requests],
  );

  async function mark(request: ContactRequestRecord, status: ContactRequestStatus) {
    try {
      await updateStatus({ requestId: request._id, status });
      toast.success(`Marked ${status}`);
    } catch (error) {
      reportAppError(error, {
        action: "admin.contact.updateStatus",
        component: "AdminContactRequests",
        entityId: request._id,
      });
      toast.error(error instanceof Error ? error.message : "Update failed");
    }
  }

  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Contact</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Requests submitted through the public contact form.
          </p>
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as ContactFilter)}
          >
            <SelectTrigger className="h-9 rounded-none font-mono text-xs uppercase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {filters.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === "all" ? "All" : item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3">
        {sortedRequests.map((request) => (
          <ContactRequestRow
            key={request._id}
            onMark={mark}
            request={request}
          />
        ))}
        {requests === undefined ? (
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Loading requests
          </p>
        ) : null}
        {requests !== undefined && sortedRequests.length === 0 ? (
          <p className="font-mono text-xs uppercase text-muted-foreground">
            No contact requests
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ContactRequestRow({
  onMark,
  request,
}: {
  onMark: (
    request: ContactRequestRecord,
    status: ContactRequestStatus,
  ) => Promise<void>;
  request: ContactRequestRecord;
}) {
  return (
    <article className="grid gap-4 border border-border/80 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-lg font-semibold">{request.subject}</h3>
          <Badge
            className={cn(
              "rounded-none font-mono uppercase",
              request.status === "new"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {request.status}
          </Badge>
          {request.emailError ? (
            <Badge className="rounded-none bg-destructive text-destructive-foreground">
              Email failed
            </Badge>
          ) : request.emailedAt ? (
            <Badge className="rounded-none bg-muted text-muted-foreground">
              Emailed
            </Badge>
          ) : (
            <Badge className="rounded-none bg-muted text-muted-foreground">
              Queued
            </Badge>
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] uppercase text-muted-foreground">
          {request.name} / {request.email} / {formatDate(request.createdAt)}
        </p>
        <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {request.description}
        </p>
        {request.emailError ? (
          <p className="mt-3 text-sm text-destructive">{request.emailError}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
        <Button
          asChild
          className="rounded-none"
          size="sm"
          variant="outline"
        >
          <a href={`mailto:${request.email}?subject=${encodeURIComponent(request.subject)}`}>
            Reply
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        {request.status !== "read" ? (
          <Button
            className="rounded-none"
            onClick={() => void onMark(request, "read")}
            size="sm"
            variant="outline"
          >
            Mark read
          </Button>
        ) : null}
        {request.status !== "archived" ? (
          <Button
            className="rounded-none"
            onClick={() => void onMark(request, "archived")}
            size="sm"
            variant="outline"
          >
            Archive
          </Button>
        ) : null}
        {request.status === "archived" ? (
          <Button
            className="rounded-none"
            onClick={() => void onMark(request, "new")}
            size="sm"
            variant="outline"
          >
            Reopen
          </Button>
        ) : null}
      </div>
    </article>
  );
}

