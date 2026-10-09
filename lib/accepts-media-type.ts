export function acceptsMediaType(value: string | null, mediaType: string) {
  if (!value) return false;
  return value.split(",").some((part) => {
    const [type, ...parameters] = part.trim().toLowerCase().split(";");
    if (type !== mediaType && type !== "text/*") {
      return false;
    }
    const quality = parameters.find((parameter) =>
      parameter.trim().startsWith("q="),
    );
    return quality === undefined || Number(quality.split("=")[1]) > 0;
  });
}
