import { z } from "zod";
import { PI_APPS } from "../../shared/apps";
import type { ToolView } from "../lib/tools";
import { IconExternal } from "./Icons";

const menuSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }),
  halls: z.array(z.object({
    hall: z.string().min(1),
    error: z.string().optional(),
    meals: z.array(z.object({
      meal: z.string().min(1),
      stations: z.array(z.object({
        station: z.string().min(1),
        items: z.array(z.string().min(1)),
      })),
    })).optional(),
  }).refine((hall) => !!hall.error || hall.meals !== undefined)),
});

const menusApp = PI_APPS.find((app) => app.key === "tigermenus")!;

/** Render the dated response as-is; relative days belong to the request only. */
export function MenuCard({ view }: { view: ToolView }) {
  const parsed = menuSchema.safeParse(view.data);
  const menu = parsed.success ? parsed.data : null;
  const running = !view.errorText && ["input-streaming", "input-available", "call"].includes(view.state);
  const input = view.input as { meal?: unknown } | null;
  const requestedMeal = typeof input?.meal === "string" && ["breakfast", "lunch", "dinner"].includes(input.meal)
    ? input.meal : null;
  const dateLabel = menu ? new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${menu.date}T12:00:00Z`)) : null;

  return (
    <section className="menu-card" aria-label="TigerMenus dining menus" aria-busy={running}>
      <header className="menu-card-head">
        <span className="menu-source"><span className="menu-dot" aria-hidden="true" />TigerMenus</span>
        <a href={menusApp.home} target="_blank" rel="noreferrer">
          Open TigerMenus <IconExternal size={12} />
        </a>
      </header>
      {running ? (
        <p className="menu-status" role="status">Checking dining hall menus…</p>
      ) : !menu ? (
        <div className="menu-status menu-error" role="status">
          <strong>Menus couldn’t be loaded.</strong>
          <p>Ask PI to try again, or check TigerMenus directly.</p>
        </div>
      ) : (
        <>
          <div className="menu-date">
            <time dateTime={menu.date}>{dateLabel}</time>
            <span>{requestedMeal ? `${requestedMeal[0].toUpperCase()}${requestedMeal.slice(1)}` : "All meals"}</span>
          </div>
          {menu.halls.length === 0 && <p className="menu-status">No dining hall menus were returned for this date.</p>}
          <div className="menu-halls">
            {menu.halls.map((hall, hallIndex) => (
              <section className="menu-hall" key={`${hall.hall}-${hallIndex}`} aria-label={`${hall.hall} menu`}>
                <h3>{hall.hall}</h3>
                {hall.error ? (
                  <p className="menu-status menu-error">Couldn’t load this hall’s menu. Check TigerMenus or ask PI to try again.</p>
                ) : !hall.meals?.length ? (
                  <p className="menu-status">{requestedMeal ? `No ${requestedMeal} menu posted for this date.` : "No meals posted for this date."}</p>
                ) : hall.meals.map((meal, mealIndex) => (
                  <div className="menu-meal" key={`${meal.meal}-${mealIndex}`}>
                    <h4>{meal.meal}</h4>
                    {!meal.stations.some((station) => station.items.length) ? (
                      <p className="menu-status">No dishes posted for this meal.</p>
                    ) : meal.stations.filter((station) => station.items.length).map((station, stationIndex) => (
                      <div className="menu-station" key={`${station.station}-${stationIndex}`}>
                        <h5>{station.station}</h5>
                        <ul>{station.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
          <p className="menu-footnote">Only posted meals are shown. Allergen and nutrition information isn’t provided.</p>
        </>
      )}
    </section>
  );
}
