type NewsSlugStory = {
  hnItemId: number;
  title: string;
};

export function slugifyNewsTitle(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 88)
    .replace(/-+$/g, "");

  return slug || "story";
}

export function newsStorySlug(story: NewsSlugStory) {
  return `${slugifyNewsTitle(story.title)}-${story.hnItemId}`;
}

export function newsStoryPath(story: NewsSlugStory) {
  return `/news/${newsStorySlug(story)}`;
}

export function parseNewsStoryParam(value: string) {
  if (/^\d+$/.test(value)) {
    const storyId = Number(value);
    return Number.isSafeInteger(storyId) ? storyId : null;
  }

  const match = value.match(/-(\d+)$/);
  if (!match) {
    return null;
  }
  const storyId = Number(match[1]);
  return Number.isSafeInteger(storyId) ? storyId : null;
}
