import { useState } from "react";
import {
  housingObject,
  housingRows,
  housingDataStatus,
  housingUrl,
  housingTourUrl,
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
function mediaTitle(media: Record<string, unknown>) {
  return (
    ((
      {
        floor_plan: "Floor plan",
        room_plan: "Room plan",
        thumbnail: "Building photo",
        "360": "360° tour",
      } as Record<string, string>
    )[text(media.type)] || "Room image") +
    (media.floor ? ` · floor ${text(media.floor)}` : "")
  );
}
function MediaPreview({
  media,
  roomLabel,
}: {
  media: Record<string, unknown>;
  roomLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = housingUrl(media.url)!;
  const title = mediaTitle(media);
  const tour = media.type === "360" ? housingTourUrl(url) : null;
  const image =
    media.type !== "360" &&
    /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(new URL(url).pathname);
  return (
    <>
      <div className="draw-media-stage">
        {tour ? (
          <iframe
            src={tour}
            title={`${title}${roomLabel ? ` — ${roomLabel}` : ""}`}
            sandbox="allow-scripts allow-same-origin"
            allow="fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : image && !failed ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${title.toLowerCase()} in full size`}
          >
            <img
              src={url}
              alt={`${title}${roomLabel ? ` — ${roomLabel}` : ""}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
            />
          </a>
        ) : (
          <a
            className="draw-media-placeholder"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {failed
              ? "Preview unavailable · open original ↗"
              : media.type === "360"
                ? "Open 360° tour ↗"
                : /\.pdf$/i.test(new URL(url).pathname)
                  ? "Open PDF floor plan ↗"
                  : "Open original ↗"}
          </a>
        )}
      </div>
      <div className="draw-media-caption">
        <div>
          <strong>{title}</strong>
          <span className="draw-media-room">
            {tour ? "Drag to look around · scroll to zoom" : roomLabel}
          </span>
        </div>
        <a href={url} target="_blank" rel="noreferrer">
          {tour ? "Full screen ↗" : "Open original ↗"}
        </a>
      </div>
      {media.media_type === "EXAMPLE" && (
        <p className="draw-media-note">
          Example view · may show a similar room or section.
        </p>
      )}
    </>
  );
}
function MediaGallery({
  media,
  roomLabel,
}: {
  media: Record<string, unknown>[];
  roomLabel: string;
}) {
  const items = media.filter((m) => housingUrl(m.url)).slice(0, 20);
  const [selected, setSelected] = useState(0);
  const active = items[Math.min(selected, items.length - 1)];
  if (!active) return null;
  return (
    <section
      className="draw-gallery"
      aria-label={roomLabel ? `Media for ${roomLabel}` : "Room media"}
    >
      {roomLabel && (
        <header className="draw-gallery-header">
          <strong>{roomLabel}</strong>
          <span>{items.length} views</span>
        </header>
      )}
      <MediaPreview
        key={text(active.url)}
        media={active}
        roomLabel={roomLabel}
      />
      {items.length > 1 && (
        <div
          className="draw-media-selector"
          role="group"
          aria-label="Choose a view"
        >
          {items.map((item, i) => {
            const url = housingUrl(item.url)!;
            const tour = item.type === "360" ? housingTourUrl(url) : null;
            const thumbnail = tour
              ? new URL("preview.jpg", tour).href
              : item.type !== "360" &&
                  /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(
                    new URL(url).pathname,
                  )
                ? url
                : null;
            return (
              <button
                type="button"
                key={`${url}-${i}`}
                className="draw-media-choice"
                aria-pressed={item === active}
                onClick={() => setSelected(i)}
              >
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <span className="draw-choice-icon">
                    {item.type === "360" ? "360°" : "PDF"}
                  </span>
                )}
                <span>{mediaTitle(item)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
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
  const dataStatus = housingDataStatus(data);
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
        <MediaGallery
          media={media}
          roomLabel={[text(data.building), text(data.room_no)]
            .filter(Boolean)
            .join(" ")}
        />
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
      {dataStatus && <p className="draw-data-status">{dataStatus}</p>}
      {(housingRows(data.sources).some((s) => s.source_kind === "static") ||
        housingRows(housingObject(data.room).sources).some(
          (s) => s.source_kind === "static",
        )) && (
        <p className="draw-notice">
          Original update dates for archived information are unknown.
        </p>
      )}
    </div>
  );
}
