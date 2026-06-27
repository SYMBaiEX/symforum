"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { convexRefs } from "@/lib/convex-refs";
import { useMutation } from "convex/react";
import { Send } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

type ContactFormState = {
  name: string;
  email: string;
  subject: string;
  description: string;
};

const blankForm: ContactFormState = {
  name: "",
  email: "",
  subject: "",
  description: "",
};

export function ContactForm() {
  const submitContact = useMutation(convexRefs.contact.submit);
  const [form, setForm] = useState<ContactFormState>(blankForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await submitContact({
        request: {
          name: form.name,
          email: form.email,
          subject: form.subject,
          description: form.description,
          source: "contact-page",
          userAgent:
            typeof navigator === "undefined" ? undefined : navigator.userAgent,
        },
      });
      setForm(blankForm);
      setSentAt(Date.now());
      toast.success("Contact request sent");
    } catch (error) {
      reportAppError(error, {
        action: "contact.submit",
        component: "ContactForm",
      });
      toast.error(
        error instanceof Error ? error.message : "Contact request failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-8 max-w-3xl" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input
            autoComplete="name"
            className="h-11 rounded-none"
            maxLength={90}
            minLength={2}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            required
            value={form.name}
          />
        </Field>
        <Field label="Email">
          <Input
            autoComplete="email"
            className="h-11 rounded-none"
            maxLength={180}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            required
            type="email"
            value={form.email}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Subject">
          <Input
            className="h-11 rounded-none"
            maxLength={140}
            minLength={3}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                subject: event.target.value,
              }))
            }
            required
            value={form.subject}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Description">
          <Textarea
            className="min-h-40 rounded-none"
            maxLength={5000}
            minLength={12}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            required
            value={form.description}
          />
        </Field>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <p
          aria-live="polite"
          className="min-h-5 font-mono text-[11px] uppercase text-muted-foreground"
        >
          {sentAt ? "Sent. I will see it in the admin console." : ""}
        </p>
        <Button className="rounded-none" disabled={isSubmitting} type="submit">
          <Send aria-hidden="true" />
          {isSubmitting ? "Sending" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
