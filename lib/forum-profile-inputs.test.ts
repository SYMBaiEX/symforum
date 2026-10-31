import { expect, test } from "vitest";
import { forumProfileInputIssues } from "./forum-profile-inputs";
const blank = { avatarUrl: "", birthday: "", websiteUrl: "" };
test("optional blank values and server-valid URL schemes stay accepted", () => {
  expect(forumProfileInputIssues(blank)).toEqual({});
  expect(
    forumProfileInputIssues({
      avatarUrl: " https://example.com/a.png ",
      websiteUrl: "http://example.com",
      birthday: " 2000-02-29 ",
    }),
  ).toEqual({});
  expect(
    forumProfileInputIssues({
      avatarUrl: "https://user:pass@example.com/a",
      websiteUrl: "http://localhost:8080",
      birthday: "",
    }),
  ).toEqual({});
});
for (const value of [
  "example.com",
  "https://",
  "not a URL",
  "javascript:alert(1)",
  "ftp://example.com",
]) {
  test(`rejects invalid profile URL ${value}`, () => {
    expect(
      forumProfileInputIssues({ ...blank, avatarUrl: value }).avatarUrl,
    ).toBeDefined();
    expect(
      forumProfileInputIssues({ ...blank, websiteUrl: value }).websiteUrl,
    ).toBeDefined();
  });
}
for (const birthday of [
  "2000-02-29",
  "2024-02-29",
  "0000-01-01",
  "9999-12-31",
  "2100-01-01",
]) {
  test(`accepts existing server calendar contract ${birthday}`, () => {
    expect(forumProfileInputIssues({ ...blank, birthday })).toEqual({});
  });
}
for (const birthday of [
  "2023-02-29",
  "1900-02-29",
  "2024-04-31",
  "2024-13-01",
  "2024-00-01",
  "2024-01-00",
  "2024-2-09",
  "01/01/2024",
  "10000-01-01",
  "2024-01-01x",
]) {
  test(`rejects malformed or impossible date ${birthday}`, () => {
    expect(
      forumProfileInputIssues({ ...blank, birthday }).birthday,
    ).toBeDefined();
  });
}
test("checks trimmed URL limits without altering the source draft", () => {
  const values = {
    ...blank,
    avatarUrl: `https://example.com/${"a".repeat(500)}`,
    websiteUrl: `https://example.com/${"b".repeat(240)}`,
  };
  const original = { ...values };
  expect(Object.keys(forumProfileInputIssues(values))).toEqual([
    "avatarUrl",
    "websiteUrl",
  ]);
  expect(values).toEqual(original);
});
