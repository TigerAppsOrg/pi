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
export function housingDataStatus(value: unknown): string | null {
  const data = housingObject(value);
  const sources = [
    ...housingRows(data.sources),
    ...housingRows(housingObject(data.room).sources),
    ...housingRows(housingObject(data.reviews).sources),
  ];
  const kinds = new Set(sources.map((source) => source.source_kind));
  const referencePlans = Array.isArray(data.plans) && data.partial !== true;
  const fallback =
    sources.some(
      (source) =>
        source.source_kind === "static" && source.purpose !== "reference_asset",
    ) && !referencePlans;
  if (fallback)
    return kinds.has("live") || kinds.has("cache")
      ? "Includes saved information"
      : "Saved information";
  if (kinds.has("cache")) return "Recently retrieved";
  if (kinds.has("live")) return "Live data";
  return null;
}

/** Only embed the known external tour host; other media keeps its original link. */
export function housingTourUrl(value: unknown): string | null {
  const safe = housingUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return url.origin === "https://purv360s.z13.web.core.windows.net" &&
    url.pathname.startsWith("/images/") &&
    (url.pathname.endsWith("/") || /\/index\.html?$/i.test(url.pathname))
    ? safe
    : null;
}

export function housingWarnings(value: unknown): string[] {
  const legacyNotices = new Set([
    "Floor plans are static assets; their original update dates are unknown.",
    "Original update dates for archived information are unknown.",
    "Static source data; original update dates are unknown.",
  ]);
  return Array.isArray(value)
    ? value.filter(
        (warning): warning is string =>
          typeof warning === "string" && !legacyNotices.has(warning.trim()),
      )
    : [];
}
