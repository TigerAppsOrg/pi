export function housingObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function housingRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .filter((v) => v !== null && typeof v === "object" && !Array.isArray(v))
        .map(housingObject)
    : [];
}
export function housingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function housingError(value: string | null): string {
  if (!value) return "TigerDraw couldn't answer that. Try again later.";
  try {
    const error = housingObject(housingObject(JSON.parse(value)).error);
    if (typeof error.message === "string") return error.message;
  } catch {
    /* Transport errors use the friendly fallback. */
  }
  return "TigerDraw couldn't answer that. Try again later.";
}
export function housingSources(
  value: unknown,
): { url: string; kind: string }[] {
  const data = housingObject(value);
  const sources = [
    ...housingRows(data.sources),
    ...housingRows(housingObject(data.room).sources),
    ...housingRows(housingObject(data.reviews).sources),
  ];
  return [
    ...new Map(
      sources.flatMap((s) => {
        const url = housingUrl(s.source_url) ?? housingUrl(s.source);
        return url
          ? [
              [
                url,
                {
                  url,
                  kind:
                    typeof s.source_kind === "string"
                      ? s.source_kind
                      : "source",
                },
              ] as const,
            ]
          : [];
      }),
    ).values(),
  ];
}
