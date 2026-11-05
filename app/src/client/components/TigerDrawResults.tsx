import { useState } from "react";
import {
  IconPeople,
  IconArea,
  IconFloors,
  IconCooling,
  IconElevator,
  IconRank,
  IconStar,
} from "./Icons";
import {
  housingObject,
  housingContent,
  housingDataStatus,
  housingUrl,
  housingTourUrl,
  housingWarnings,
} from "../lib/tigerdraw";

const text = (value: unknown) => (typeof value === "string" ? value : "");
function RoomRow({ room }: { room: Record<string, unknown> }) {
  const conflicts = housingObject(room.conflicts);
  const known = (field: string) => !Object.hasOwn(conflicts, field);
  const numeric = (field: string) =>
    known(field) &&
    typeof room[field] === "number" &&
    Number.isFinite(room[field]);
  const facts = [
    numeric("occupancy") && {
      key: "occupancy",
      icon: IconPeople,
      label: "Occupancy",
      value: `${room.occupancy} ${room.occupancy === 1 ? "person" : "people"}`,
    },
    numeric("sq_footage") && {
      key: "area",
      icon: IconArea,
      label: "Room size",
      value: `${room.sq_footage} sq ft`,
    },
    known("floor") &&
      (typeof room.floor === "string" || typeof room.floor === "number") &&
      String(room.floor).trim() !== "" && {
        key: "floor",
        icon: IconFloors,
        label: "Floor",
        value: String(room.floor),
      },
    known("ac") &&
      room.ac === true && {
        key: "ac",
        icon: IconCooling,
        label: "Air conditioning",
        value: "Available",
      },
    known("elevator") &&
      room.elevator === true && {
        key: "elevator",
        icon: IconElevator,
        label: "Elevator",
        value: "Available",
      },
    numeric("draw_rank") && {
      key: "rank",
      icon: IconRank,
      label: "Historical draw rank",
      value: `#${room.draw_rank}`,
    },
    numeric("avg_rating") && {
      key: "rating",
      icon: IconStar,
      label: "Student rating",
      value: `${room.avg_rating}/5${numeric("num_reviews") ? ` · ${room.num_reviews} ${room.num_reviews === 1 ? "review" : "reviews"}` : ""}`,
    },
  ].filter((fact) => !!fact);
  return (
    <article className="draw-room">
      <strong className="draw-room-title">
        {text(room.building)} {text(room.room_no)}
      </strong>
      {facts.length > 0 && (
        <dl className="draw-room-facts">
          {facts.map(({ key, icon: FactIcon, label, value }) => (
            <div className="draw-room-fact" key={key}>
              <FactIcon size={18} />
              <div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
function mediaTitle(media: Record<string, unknown>) {
  return (
    ((
      {
        floor_plan: /\.pdf$/i.test(new URL(housingUrl(media.url)!).pathname)
          ? "PDF floor plan"
          : "Image floor plan",
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
  const preview = housingUrl(media.preview_url);
  const image =
    preview ||
    (media.type !== "360" &&
      /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(new URL(url).pathname));
  return (
    <>
      <div
        className={`draw-media-stage${!tour && (!image || failed) ? " draw-media-stage-compact" : ""}`}
      >
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
              src={preview ?? url}
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
          {tour
            ? "Full screen ↗"
            : /\.pdf$/i.test(new URL(url).pathname)
              ? "Open PDF ↗"
              : "Open original ↗"}
        </a>
      </div>
      {media.media_type === "EXAMPLE" && (
        <p className="draw-media-note">
          {media.type === "floor_plan" || media.type === "room_plan"
            ? "Example plan · layout may differ."
            : "Example view · may show a similar room or section."}
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
                : housingUrl(item.preview_url);
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
  const { rooms, buildings, media, reviews } = housingContent(data);
  const reviewData = housingObject(data.reviews);
  if (![rooms, buildings, media, reviews].some((rows) => rows.length > 0))
    return null;
  const coverage = housingObject(data.coverage);
  const fallback = Array.isArray(coverage.static_fallback)
    ? coverage.static_fallback.length
    : 0;
  const warnings = housingWarnings(data.warnings);
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
    </div>
  );
}
