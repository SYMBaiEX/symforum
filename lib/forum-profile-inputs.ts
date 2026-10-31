export type ForumProfileInputIssues = Partial<
  Record<"avatarUrl" | "birthday" | "websiteUrl", string>
>;

// Presentation checks mirror cleanOptionalForumUrl/Birthday in convex/forum.ts.
// Do not normalize the draft: the server remains authoritative on save.
export function forumProfileInputIssues(values: {
  avatarUrl: string;
  birthday: string;
  websiteUrl: string;
}): ForumProfileInputIssues {
  const issues: ForumProfileInputIssues = {};
  for (const [field, limit, label] of [
    ["avatarUrl", 500, "Avatar URL"],
    ["websiteUrl", 240, "Website URL"],
  ] as const) {
    const value = values[field].trim();
    if (!value) continue;
    if (value.length > limit) {
      issues[field] = `Use ${limit} characters or fewer.`;
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues[field] = `${label} must use http or https.`;
      }
    } catch {
      issues[field] = `${label} must be a valid URL.`;
    }
  }
  const birthday = values.birthday.trim();
  if (birthday) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      issues.birthday = "Birthday must use YYYY-MM-DD.";
    } else {
      const date = new Date(`${birthday}T00:00:00.000Z`);
      if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== birthday
      ) {
        issues.birthday = "Birthday must be a valid date.";
      }
    }
  }
  return issues;
}
