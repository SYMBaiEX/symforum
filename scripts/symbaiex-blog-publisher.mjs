#!/usr/bin/env bun

import { PRIMARY_SITE_URL } from "../lib/site-urls.ts";
/** Secure, deliberately small publisher for the authenticated admin posts API. */
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

const DEFAULT_API_BASE = PRIMARY_SITE_URL + "/api/admin/posts";
const KEYCHAIN_SERVICE = "symbaiex-blog-admin";
const KEYCHAIN_ACCOUNT = "codex-social-ops";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_TITLE = 180;
const MAX_EXCERPT = 500;
const MAX_BODY = 100_000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 48;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_IMAGES = 8;
const INLINE_IMAGE_TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PublisherError extends Error {}

export function redactSecrets(value) {
  const text = String(value ?? "");
  return text
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:symbaiex_admin_)?token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|authorization|api[_-]?key)=)[^&#\s]+/gi, "$1[REDACTED]");
}

function fail(message) {
  throw new PublisherError(message);
}

function record(value, name = "input") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function boundedString(value, name, maximum) {
  if (typeof value !== "string") fail(`${name} must be a string`);
  const clean = value.trim();
  if (!clean) fail(`${name} must not be empty`);
  if (clean.length > maximum) fail(`${name} exceeds ${maximum} characters`);
  return clean;
}

function publishedAt(value) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0 || value > 8_640_000_000_000_000) fail("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
    return value;
  }
  if (typeof value !== "string") fail("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) fail("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
  const [year, month, day] = match.slice(1, 4).map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (year === 0 || calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) fail("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) fail("publishedAt must be an integer epoch milliseconds value or a strict ISO-8601 timestamp");
  return timestamp;
}

function optionalBoundedString(value, name, maximum) {
  if (value === undefined) return undefined;
  return boundedString(value, name, maximum);
}

function safeImageUrl(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 2048) fail("imageUrl must be a bounded HTTPS URL");
  let parsed;
  try { parsed = new URL(value); } catch { fail("imageUrl must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail("imageUrl must be a safe HTTPS URL");
  return parsed.toString();
}

function inlineImages(value, body) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_INLINE_IMAGES) {
    fail(`inlineImages must contain 2 to ${MAX_INLINE_IMAGES} images`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const source = record(entry, `inlineImages[${index}]`);
    const allowed = new Set(["token", "path", "url", "alt", "credit"]);
    for (const key of Object.keys(source)) if (!allowed.has(key)) fail(`unexpected inlineImages[${index}] field: ${key}`);
    const token = boundedString(source.token, `inlineImages[${index}].token`, 64).toLowerCase();
    if (!INLINE_IMAGE_TOKEN.test(token)) fail(`inlineImages[${index}].token must use lowercase letters, digits, and single hyphens`);
    if (seen.has(token)) fail("inlineImages tokens must be unique");
    seen.add(token);
    const path = optionalBoundedString(source.path, `inlineImages[${index}].path`, 1024);
    const url = safeImageUrl(source.url);
    if (!path && !url) fail(`inlineImages[${index}] requires path or url`);
    const placeholder = `{{inline-image:${token}}}`;
    const occurrences = body.split(placeholder).length - 1;
    if (occurrences !== 1) fail(`${placeholder} must appear exactly once in body`);
    return {
      token,
      ...(path ? { path } : {}),
      ...(url ? { url } : {}),
      alt: boundedString(source.alt, `inlineImages[${index}].alt`, 300),
      ...(source.credit ? { credit: boundedString(source.credit, `inlineImages[${index}].credit`, 300) } : {}),
    };
  });
}

export function validateDocument(input) {
  const source = record(input);
  const allowed = new Set(["slug", "title", "excerpt", "body", "tags", "status", "publishedAt", "readingMinutes", "featured", "imageUrl", "imageAlt", "imageCredit", "inlineImages"]);
  for (const key of Object.keys(source)) if (!allowed.has(key)) fail(`unexpected input field: ${key}`);
  const slug = boundedString(source.slug, "slug", 96).toLowerCase();
  if (!SLUG.test(slug)) fail("slug must use lowercase letters, digits, and single hyphens");
  if (!Array.isArray(source.tags) || source.tags.length > MAX_TAGS) fail(`tags must contain at most ${MAX_TAGS} strings`);
  const tags = source.tags.map((tag) => boundedString(tag, "tag", MAX_TAG_LENGTH));
  if (new Set(tags.map((tag) => tag.toLowerCase())).size !== tags.length) fail("tags must be unique");
  if (source.status !== "draft" && source.status !== "published") fail("status must be draft or published");
  if (!Number.isInteger(source.readingMinutes) || source.readingMinutes < 1 || source.readingMinutes > 240) fail("readingMinutes must be an integer from 1 to 240");
  if (typeof source.featured !== "boolean") fail("featured must be a boolean");
  const imageUrl = safeImageUrl(source.imageUrl);
  const imageAlt = optionalBoundedString(source.imageAlt, "imageAlt", 300);
  const imageCredit = optionalBoundedString(source.imageCredit, "imageCredit", 300);
  const body = boundedString(source.body, "body", MAX_BODY).replace(/\r\n/g, "\n");
  return {
    slug,
    title: boundedString(source.title, "title", MAX_TITLE),
    excerpt: boundedString(source.excerpt, "excerpt", MAX_EXCERPT),
    body,
    tags,
    status: source.status,
    publishedAt: publishedAt(source.publishedAt),
    readingMinutes: source.readingMinutes,
    featured: source.featured,
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageAlt ? { imageAlt } : {}),
    ...(imageCredit ? { imageCredit } : {}),
    ...(source.inlineImages !== undefined ? { inlineImages: inlineImages(source.inlineImages, body) } : {}),
  };
}

export function parseArgs(args) {
  const options = { mode: "dry-run", update: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--input") options.input = args[++i];
    else if (arg === "--image") options.image = args[++i];
    else if (arg === "--apply-draft") fail("draft publishing is disabled for symbaiex.com; use --apply-published");
    else if (arg === "--apply-published") options.mode = "apply-published";
    else if (arg === "--update") options.update = true;
    else if (arg === "--help") options.help = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.input) fail("--input <path> is required");
  if (options.image !== undefined && (!options.image || options.image.startsWith("--"))) fail("--image <path> requires a local image path");
  return options;
}

function apiBaseFromEnv(env) {
  const candidate = env.SYMBAIEX_BLOG_API_BASE_URL || DEFAULT_API_BASE;
  let url;
  try { url = new URL(candidate); } catch { fail("SYMBAIEX_BLOG_API_BASE_URL must be a valid URL"); }
  const localhost = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localhost) fail("API base must use HTTPS (HTTP is limited to localhost)");
  if (url.username || url.password) fail("API base must not include credentials");
  return url.toString().replace(/\/$/, "");
}

export function resolveToken(env = process.env, platform = process.platform) {
  if (env.SYMBAIEX_ADMIN_TOKEN) return env.SYMBAIEX_ADMIN_TOKEN;
  if (platform === "darwin") {
    try {
      return execFileSync("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { /* Fail with one stable message below; Keychain diagnostics may leak. */ }
  }
  fail("admin token is unavailable; set SYMBAIEX_ADMIN_TOKEN or configure the documented macOS Keychain entry");
}

function comparable(post) {
  const p = record(post, "API post");
  const selected = {};
  for (const key of ["slug", "title", "excerpt", "body", "tags", "status", "publishedAt", "readingMinutes", "featured", "imageUrl", "imageAlt", "imageCredit"]) {
    selected[key] = key === "publishedAt" ? publishedAt(p[key]) : p[key] ?? undefined;
  }
  if (Array.isArray(selected.tags)) {
    selected.tags = selected.tags.map((tag) => typeof tag === "string" ? tag.trim().toLowerCase() : tag);
  }
  return JSON.stringify(selected);
}

function resultUrl(post) {
  if (!post || typeof post !== "object") return undefined;
  for (const key of ["publicUrl", "url"]) if (typeof post[key] === "string" && /^https:\/\//.test(post[key])) return post[key];
  return undefined;
}

async function request(fetchImpl, url, token, method, body) {
  let response;
  try {
    response = await fetchImpl(url, { method, redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) { fail(`API ${method} request failed: ${redactSecrets(error instanceof Error ? error.message : error)}`); }
  let payload = null;
  try { payload = await response.json(); } catch { /* status below remains useful without echoing raw response */ }
  return { response, payload };
}

function imageContentType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  fail("--image must be a PNG, JPEG, GIF, or WebP file");
}

async function readImage(path, label = "--image") {
  let bytes;
  try { bytes = await readFile(path); } catch { fail(`${label} could not be read`); }
  if (bytes.length === 0) fail(`${label} must not be empty`);
  if (bytes.length > MAX_IMAGE_BYTES) fail(`${label} exceeds 8388608 bytes`);
  return {
    bytes,
    contentType: imageContentType(bytes),
    digest: createHash("sha256").update(bytes).digest("base64"),
  };
}

function markdownImageUrl(body, alt) {
  const pattern = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g;
  for (const match of body.matchAll(pattern)) if (match[1] === alt) return match[2];
  return undefined;
}

function renderInlineImage(entry, url) {
  return `![${entry.alt.replace(/[\[\]]/g, "")}](${url})${entry.credit ? `\n\n*Image: ${entry.credit}*` : ""}`;
}

async function resolveInlineImages({ entries, inputPath, existingBody, fetchImpl, base, token, apply }) {
  const resolved = [];
  const digests = new Set();
  for (const entry of entries) {
    const localPath = entry.path ? (isAbsolute(entry.path) ? entry.path : resolve(dirname(inputPath), entry.path)) : undefined;
    const image = localPath ? await readImage(localPath, `inline image ${entry.token}`) : null;
    if (image) {
      if (digests.has(image.digest)) fail("inlineImages must use distinct image files");
      digests.add(image.digest);
    }
    let url = entry.url || markdownImageUrl(existingBody || "", entry.alt);
    let action = url ? "linked" : "pending";
    if (apply && image) {
      if (url && await storedImageMatches(fetchImpl, url, image.digest)) action = "reused";
      else {
        url = await uploadImage(fetchImpl, base, token, image);
        action = "uploaded";
      }
    }
    if (apply && !url) fail(`inline image ${entry.token} has no reusable or uploaded URL`);
    resolved.push({ ...entry, ...(url ? { url } : {}), action, ...(image ? { digest: image.digest } : {}) });
  }
  return resolved;
}

function reusableStorageUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const convexHost = url.hostname.endsWith(".convex.cloud") || url.hostname.endsWith(".convex.site");
    return url.protocol === "https:" && convexHost && url.pathname.startsWith("/api/storage/") ? url.toString() : null;
  } catch { return null; }
}

async function storedImageMatches(fetchImpl, url, digest) {
  const reusable = reusableStorageUrl(url);
  if (!reusable) return false;
  try {
    const response = await fetchImpl(reusable, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
    return response.ok && response.headers.get("content-type")?.toLowerCase().startsWith("image/") === true && response.headers.get("digest") === `sha-256=${digest}`;
  } catch { return false; }
}

async function uploadImage(fetchImpl, base, token, image) {
  const url = new URL("../upload", `${base}/`).toString();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": image.contentType },
      body: image.bytes,
    });
  } catch (error) { fail(`image upload failed: ${redactSecrets(error instanceof Error ? error.message : error)}`); }
  let payload = null;
  try { payload = await response.json(); } catch { /* stable status error below */ }
  if (!response.ok) fail(`image upload failed with status ${response.status}`);
  const uploadedUrl = safeImageUrl(payload?.url);
  if (!uploadedUrl) fail("image upload response did not include a URL");
  return uploadedUrl;
}

export async function runPublisher({ args = process.argv.slice(2), env = process.env, fetchImpl = fetch, platform = process.platform, tokenResolver = resolveToken } = {}) {
  const options = parseArgs(args);
  if (options.help) return { help: true };
  const raw = await readFile(options.input, "utf8");
  if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) fail("input exceeds 1048576 bytes");
  let document;
  try { document = JSON.parse(raw); } catch { fail("input must contain valid JSON"); }
  const input = validateDocument(document);
  const image = options.image ? await readImage(options.image) : null;
  const { inlineImages: inlineImageEntries = [], ...postInput } = input;
  let post = { ...postInput, status: options.mode === "dry-run" ? input.status : "published" };
  if (options.mode === "dry-run") {
    const resolvedInlineImages = await resolveInlineImages({ entries: inlineImageEntries, inputPath: options.input, existingBody: "", fetchImpl, apply: false });
    const allDigests = [image?.digest, ...resolvedInlineImages.map((entry) => entry.digest)].filter(Boolean);
    if (new Set(allDigests).size !== allDigests.length) fail("cover and inlineImages must use distinct image files");
    return {
      mode: "dry-run",
      slug: post.slug,
      action: "dry-run",
      status: post.status,
      summary: { title: post.title, tagCount: post.tags.length, readingMinutes: post.readingMinutes, featured: post.featured, hasImage: Boolean(post.imageUrl || image), localImage: Boolean(image), inlineImageCount: resolvedInlineImages.length, totalVisualCount: Number(Boolean(post.imageUrl || image)) + resolvedInlineImages.length },
    };
  }

  const token = tokenResolver(env, platform);
  if (!token || !String(token).trim()) fail("admin token is unavailable");
  const base = apiBaseFromEnv(env);
  const get = await request(fetchImpl, `${base}/${encodeURIComponent(post.slug)}`, token, "GET");
  if (get.response.status !== 404 && !get.response.ok) fail(`API GET failed with status ${get.response.status}`);
  const resolvedInlineImages = await resolveInlineImages({ entries: inlineImageEntries, inputPath: options.input, existingBody: get.response.ok ? get.payload?.post?.body : "", fetchImpl, base, token, apply: true });
  for (const entry of resolvedInlineImages) post.body = post.body.replace(`{{inline-image:${entry.token}}}`, renderInlineImage(entry, entry.url));
  if (post.body.length > MAX_BODY) fail(`body exceeds ${MAX_BODY} characters after resolving inline images`);
  let imageAction;
  if (image) {
    const existingImageUrl = get.response.ok ? get.payload?.post?.imageUrl : undefined;
    if (await storedImageMatches(fetchImpl, existingImageUrl, image.digest)) {
      post = { ...post, imageUrl: existingImageUrl };
      imageAction = "reused";
    } else {
      post = { ...post, imageUrl: await uploadImage(fetchImpl, base, token, image) };
      imageAction = "uploaded";
    }
  }
  if (get.response.status === 404) {
    const create = await request(fetchImpl, base, token, "POST", post);
    if (!create.response.ok) fail(`API POST failed with status ${create.response.status}`);
    return { mode: options.mode, slug: post.slug, action: "create", status: create.response.status, ...(imageAction ? { imageAction } : {}), inlineImages: resolvedInlineImages.map(({ token, url, action }) => ({ token, url, action })), ...(resultUrl(create.payload?.post) ? { publicUrl: resultUrl(create.payload.post) } : {}) };
  }
  if (comparable(get.payload?.post) === comparable(post)) return { mode: options.mode, slug: post.slug, action: "noop", status: get.response.status, ...(imageAction ? { imageAction } : {}), inlineImages: resolvedInlineImages.map(({ token, url, action }) => ({ token, url, action })), ...(resultUrl(get.payload?.post) ? { publicUrl: resultUrl(get.payload.post) } : {}) };
  if (!options.update) fail("existing post differs; re-run with --update after reviewing the change");
  const update = await request(fetchImpl, `${base}/${encodeURIComponent(post.slug)}`, token, "PATCH", post);
  if (!update.response.ok) fail(`API PATCH failed with status ${update.response.status}`);
  return { mode: options.mode, slug: post.slug, action: "update", status: update.response.status, ...(imageAction ? { imageAction } : {}), inlineImages: resolvedInlineImages.map(({ token, url, action }) => ({ token, url, action })), ...(resultUrl(update.payload?.post) ? { publicUrl: resultUrl(update.payload.post) } : {}) };
}

if (import.meta.main) {
  try {
    const result = await runPublisher();
    if (result.help) console.log("Usage: bun scripts/symbaiex-blog-publisher.mjs --input post.json [--image cover.png] [--apply-published] [--update]");
    else console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ error: redactSecrets(error instanceof Error ? error.message : error) }));
    process.exitCode = 1;
  }
}
