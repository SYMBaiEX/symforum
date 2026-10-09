"use client";

import { reportAppError } from "@/components/app-error-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { userFacingError } from "@/lib/auth-errors";
import { isExpectedContactSubmissionError } from "@/lib/contact-errors";
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

    const name = form.name.replace(/\s+/g, " ").trim();
    const email = form.email.trim();
    const subject = form.subject.replace(/\s+/g, " ").trim();
    const description = form.description.replace(/\r\n/g, "\n").trim();

    if (name.length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    if (subject.length < 3) {
      toast.error("Subject must be at least 3 characters");
      return;
    }
    if (description.length < 12) {
      toast.error("Description must be at least 12 characters");
      return;
    }

    setIsSubmitting(true);
    setSentAt(null);
    try {
      await submitContact({
        request: {
          name,
          email,
          subject,
          description,
          source: "contact-page",
          userAgent:
            typeof navigator === "undefined" ? undefined : navigator.userAgent,
        },
      });
      setForm(blankForm);
      setSentAt(Date.now());
      toast.success("Contact request sent");
    } catch (error) {
      if (!isExpectedContactSubmissionError(error)) {
        reportAppError(error, {
          action: "contact.submit",
          component: "ContactForm",
        });
      }
      toast.error(userFacingError(error, "Contact request failed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-4 max-w-none" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input
            autoComplete="name"
            className="h-11"
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
            className="h-11"
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
            className="h-11"
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
            className="min-h-40"
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
          {sentAt ? "Sent. I read every note and reply by email." : ""}
        </p>
        <Button
          className="forum-primary-action"
          disabled={isSubmitting}
          type="submit"
        >
          <Send aria-hidden="true" />
          {isSubmitting ? "Sending" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
