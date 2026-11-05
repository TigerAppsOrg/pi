import {
  housingObject,
  housingRows,
  housingSources,
  housingUrl,
} from "../lib/tigerdraw";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const labels: Record<string, string> = {
  sq_footage: "square footage",
  draw_rank: "historical draw rank",
  res_college: "college",
  has_360: "360 availability",
  num_reviews: "review count",
  avg_rating: "average rating",
  ac: "air conditioning",
};
function RoomRow({ room }: { room: Record<string, unknown> }) {
  const details = [
    typeof room.occupancy === "number"
      ? `${room.occupancy} person`
      : "occupancy unknown",
    typeof room.sq_footage === "number"
      ? `${room.sq_footage} sq ft`
      : "area unknown",
    typeof room.floor === "string" ? `floor ${room.floor}` : "",
    room.ac === true ? "AC" : "",
    room.elevator === true ? "elevator" : "",
    typeof room.draw_rank === "number"
      ? `historical rank ${room.draw_rank}`
      : "",
  ].filter(Boolean);
  const conflicts = Object.keys(housingObject(room.conflicts));
  return (
    <article className="draw-room">
      <strong>
        {text(room.building)} {text(room.room_no)}
      </strong>
      <p>{details.join(" · ")}</p>
      {typeof room.avg_rating === "number" && (
        <p>
          {room.avg_rating}/5 ·{" "}
          {typeof room.num_reviews === "number" ? room.num_reviews : "unknown"}{" "}
          reviews
        </p>
      )}
      {conflicts.length > 0 && (
        <p className="draw-notice">
          Conflicting{" "}
          {conflicts.map((f) => labels[f] ?? f.replaceAll("_", " ")).join(", ")}
          ; those values are unknown.
        </p>
      )}
    </article>
  );
}
export function TigerDrawResults({ value }: { value: unknown }) {
  const data = housingObject(value);
  const rooms = data.room
    ? [housingObject(data.room)]
    : housingRows(data.rooms);
  const buildings = housingRows(data.buildings);
  const media = [...housingRows(data.images), ...housingRows(data.plans)];
  const reviewData = housingObject(data.reviews);
  const reviews = housingRows(reviewData.reviews);
  const coverage = housingObject(data.coverage);
  const fallback = Array.isArray(coverage.static_fallback)
    ? coverage.static_fallback.length
    : 0;
  const warnings = Array.isArray(data.warnings)
    ? data.warnings.filter((w): w is string => typeof w === "string")
    : [];
  const sources = housingSources(data);
  return (
    <div className="draw-results">
      {data.partial === true && (
        <p className="draw-notice">
          Partial results
          {fallback ? ` · ${fallback} buildings use static fallback` : ""}.
          Coverage or current data is incomplete.
        </p>
      )}
      {rooms.slice(0, 8).map((room, i) => (
        <RoomRow
          key={`${text(room.building)}-${text(room.room_no)}-${i}`}
          room={room}
        />
      ))}
      {buildings.length > 0 && (
        <ul>
          {buildings.slice(0, 8).map((b, i) => (
            <li key={i}>
              <strong>{text(b.building)}</strong>
              {Array.isArray(b.colleges) &&
                ` · ${b.colleges.filter((c) => typeof c === "string").join(", ")}`}
            </li>
          ))}
        </ul>
      )}
      {media.length > 0 && (
        <ul>
          {media.slice(0, 20).map((m, i) => {
            const url = housingUrl(m.url);
            return (
              url && (
                <li key={i}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {text(m.type).replaceAll("_", " ") || "Image"}
                    {m.floor ? ` · floor ${text(m.floor)}` : ""}
                  </a>{" "}
                  ·{" "}
                  {text(m.media_type) === "EXAMPLE"
                    ? "example media"
                    : text(m.media_type) === "ACTUAL"
                      ? "actual media"
                      : "media type unverified"}
                </li>
              )
            );
          })}
        </ul>
      )}
      {reviews.map((r, i) => (
        <blockquote key={i}>
          <p>{text(r.untrusted_text)}</p>
          <footer>
            {typeof r.rating === "number" ? `${r.rating}/5` : ""}
            {r.date ? ` · ${text(r.date)}` : ""}
            {r.truncated === true ? " · excerpt" : ""}
          </footer>
        </blockquote>
      ))}
      {reviewData.available === false && (
        <p>Reviews are unavailable; the room may still have reviews.</p>
      )}
      {reviewData.available === true && reviews.length === 0 && (
        <p>No reviews were returned for this room.</p>
      )}
      {rooms.length === 0 && buildings.length === 0 && media.length === 0 && (
        <p>No matches or media were available for this selection.</p>
      )}
      {(rooms.length > 8 ||
        buildings.length > 8 ||
        data.truncated === true) && (
        <p className="draw-notice">
          {rooms.length > 8 || buildings.length > 8
            ? "Showing the first 8 entries. "
            : ""}
          {data.truncated === true
            ? "More results may match; narrow the search."
            : ""}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="draw-notice">{warnings.slice(0, 3).join(" ")}</p>
      )}
      {sources.length > 0 && (
        <p className="draw-sources">
          {sources.slice(0, 8).map((s, i) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
              Source {i + 1} · {s.kind}
            </a>
          ))}
        </p>
      )}
      {(housingRows(data.sources).some((s) => s.source_kind === "static") ||
        housingRows(housingObject(data.room).sources).some(
          (s) => s.source_kind === "static",
        )) && (
        <p className="draw-notice">
          Static source data; original update dates are unknown.
        </p>
      )}
    </div>
  );
}
