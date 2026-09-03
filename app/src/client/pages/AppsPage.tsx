import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  COMING_SOON,
  CUSTOM_APP_SOON,
  MASTER_RESTORE_APPS,
  PI_APPS,
  countConnected,
  type AppKey,
  type PiApp,
  type PiSettings,
  type SoonApp,
} from "../../shared/apps";
import { IconCheck, IconExternal } from "../components/Icons";
import { signOut, type Identity } from "../lib/auth";
import { friendlyError, rawError, useDesk } from "../lib/desk";
import { readAppStash, savePrefs, writeAppStash } from "../lib/store";
import { APP_INK } from "../lib/tools";
import "../styles/desk.css";

const ENGINE_APPS = PI_APPS.filter((a) => a.kind === "app");
const CALENDAR_APPS = PI_APPS.filter((a) => a.kind === "calendar");
const SOON_APPS = COMING_SOON.filter((a) => a.kind === "app");
const SOON_CALENDARS = COMING_SOON.filter((a) => a.kind === "calendar");

export function AppsPage({
  identity,
  settings,
}: {
  identity: Identity;
  settings: PiSettings;
}) {
  const desk = useDesk(settings);
  const [pending, setPending] = useState<AppKey | "all" | null>(null);
  const [saveError, setSaveError] = useState<{ text: string; raw: string } | null>(
    null
  );
  const [noLogo, setNoLogo] = useState<AppKey[]>([]);
  const [callbackError] = useState(() => {
    const err = new URLSearchParams(location.search).get("error");
    if (err) history.replaceState(null, "", "/apps");
    return err;
  });

  // Settings pushes go one at a time: two quick flips would otherwise land on
  // the server in whichever order they finished, not the order they were made.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const retryRef = useRef<PiSettings | null>(null);

  // Reconcile connections on arrival so statuses and any pending Google
  // consent link are current, not left over from the last visit.
  useEffect(() => {
    void desk.ensureSetup().catch((err) => {
      setSaveError({
        text: friendlyError(err, "your apps"),
        raw: rawError(err),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  function apply(next: PiSettings, mark: AppKey | "all") {
    savePrefs(identity.netid, { apps: next.apps, model: next.model });
    retryRef.current = next;
    setPending(mark);
    setSaveError(null);
    chain.current = chain.current.then(async () => {
      try {
        await desk.pushSettings(next);
        retryRef.current = null;
      } catch (err) {
        setSaveError({
          text: friendlyError(err, "your apps"),
          raw: rawError(err),
        });
      } finally {
        setPending((p) => (p === mark ? null : p));
      }
    });
  }

  function toggleApp(key: AppKey) {
    const on = settings.apps.includes(key);
    const apps = on
      ? settings.apps.filter((a) => a !== key)
      : [...settings.apps, key];
    apply({ ...settings, apps }, key);
  }

  const engineOn = ENGINE_APPS.map((a) => a.key).filter((k) =>
    settings.apps.includes(k)
  );

  function toggleAll() {
    if (engineOn.length > 0) {
      writeAppStash(identity.netid, engineOn);
      const apps = settings.apps.filter(
        (a) => !ENGINE_APPS.some((e) => e.key === a)
      );
      apply({ ...settings, apps }, "all");
      return;
    }
    // Flipping the switch back on restores what the student had, never more
    // than that: with nothing stashed it falls back to TigerJunction alone
    // (MASTER_RESTORE_APPS, not the default hand), so one switch can't stand
    // in for four separate yeses and hand PI apps that read personal data.
    const stashed = readAppStash(identity.netid).filter((k) =>
      ENGINE_APPS.some((e) => e.key === k)
    );
    const restore = stashed.length > 0 ? stashed : MASTER_RESTORE_APPS;
    const apps = [...new Set([...settings.apps, ...restore])];
    apply({ ...settings, apps }, "all");
  }

  const gcalReady = desk.deskState?.gcalReady === true;
  const connected = countConnected(settings.apps, { gcalReady });

  function rowFor(app: PiApp) {
    const on = settings.apps.includes(app.key);
    const authUrl = on ? desk.deskState?.authUrls?.[app.key] : undefined;
    const err = on ? desk.deskState?.appErrors?.[app.key] : undefined;
    return (
      <AppRow
        key={app.key}
        app={app}
        on={on}
        busy={pending === app.key || pending === "all"}
        logoBroken={noLogo.includes(app.key)}
        onLogoError={() =>
          setNoLogo((keys) =>
            keys.includes(app.key) ? keys : [...keys, app.key]
          )
        }
        onToggle={() => toggleApp(app.key)}
        note={
          err ? (
            // Already student-facing: the server names the app and says what
            // to do. Running it through friendlyError would match none of its
            // phrasing and replace it with something vaguer.
            <span className="app-note is-err">{err}</span>
          ) : authUrl ? (
            <span className="app-note">
              <span>One step left: Google has to say yes too.</span>
              <a className="btn btn-ink btn-sm connect-inline" href={authUrl}>
                Continue with Google
              </a>
            </span>
          ) : app.key === "gcal" && on && gcalReady ? (
            <span className="app-note is-good">
              <IconCheck size={14} /> your calendar is linked
            </span>
          ) : null
        }
      />
    );
  }

  return (
    <div className="page">
      <div className="page-inner">
        <header className="desk-head">
          <div className="desk-head-copy">
            <h1 className="page-title">
              My <span className="ink-word swipe">Apps</span>
            </h1>
            <p className="page-sub">
              Nothing is switched on until you switch it on here. Each app is a
              separate yes, even the ones TigerJunction could technically
              answer for.
            </p>
          </div>

          <div className="master-switch">
            <button
              className={engineOn.length > 0 ? "toggle on" : "toggle"}
              role="switch"
              aria-checked={engineOn.length > 0}
              aria-label="app connectivity"
              aria-busy={pending === "all"}
              disabled={pending === "all"}
              onClick={toggleAll}
            />
            <span>
              <span className="master-label">app connectivity</span>
              <span className="footnote">
                One switch for all of them. {connected} connected right now.
              </span>
            </span>
          </div>
        </header>

        {callbackError && (
          <div className="sticky-note page-note" title={callbackError}>
            <span className="lead">that didn't finish. </span>
            Google didn't hand your calendar over. Switch it off and back on for
            a fresh link, then try once more.
          </div>
        )}

        {saveError && (
          <div className="card-error page-note" title={saveError.raw}>
            <p>{saveError.text}</p>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => apply(retryRef.current ?? settings, "all")}
            >
              Try again
            </button>
          </div>
        )}

        <section className="desk-section" aria-labelledby="apps-heading">
          <h2 id="apps-heading" className="sr-only">
            TigerApps
          </h2>
          <ul className="app-list two-up">
            {ENGINE_APPS.map(rowFor)}
            {SOON_APPS.map((soon) => (
              <SoonRow key={soon.key} soon={soon} />
            ))}
          </ul>
          <p className="footnote">
            The arrow opens the app itself. That only works for apps TigerApps
            builds.
          </p>
        </section>

        <section className="desk-section" aria-labelledby="calendars-heading">
          <h2 id="calendars-heading">
            My <span className="ink-word swipe v2">Calendars</span>
          </h2>
          <hr className="hand-rule" />
          <ul className="app-list two-up">
            {CALENDAR_APPS.map(rowFor)}
            {SOON_CALENDARS.map((soon) => (
              <SoonRow key={soon.key} soon={soon} />
            ))}
          </ul>
        </section>

        <section className="desk-section" aria-labelledby="byo-heading">
          <h2 id="byo-heading" className="sr-only">
            Bring your own app
          </h2>
          <ul className="app-list">
            <SoonRow soon={CUSTOM_APP_SOON} />
          </ul>
        </section>

        <p className="footnote">
          Flip something on and any new chat picks it up straight away. A chat
          you already have open catches up on your next message.
        </p>

        <div className="desk-identity">
          <span className="avatar-lg" aria-hidden>
            {identity.netid.slice(0, 1).toUpperCase()}
          </span>
          <span className="who">
            <div className="name">{identity.name}</div>
            <div className="footnote" style={{ margin: 0 }}>
              {identity.netid} · {identity.email}
            </div>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/** One live app: mark, personality line, what it reads, switch, launch. */
function AppRow({
  app,
  on,
  busy,
  note,
  logoBroken,
  onLogoError,
  onToggle,
}: {
  app: PiApp;
  on: boolean;
  busy: boolean;
  note: ReactNode;
  logoBroken: boolean;
  onLogoError: () => void;
  onToggle: () => void;
}) {
  return (
    <li className="app-row">
      <span
        className="app-mark"
        style={{ background: APP_INK[app.key] }}
        aria-hidden
      >
        {logoBroken ? (
          app.glyph
        ) : (
          <img
            src={app.logo}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            onError={onLogoError}
          />
        )}
      </span>

      <div className="app-copy">
        <h3 className="app-name">{app.name}</h3>
        <p className="app-blurb">{app.detail}</p>
        <p className="app-reads label-xs">
          {app.personal
            ? "reads things that are yours"
            : "reads public course data"}
        </p>
        {note}
      </div>

      <div className="app-controls">
        <button
          className={on ? "toggle on" : "toggle"}
          role="switch"
          aria-checked={on}
          aria-label={app.name}
          aria-busy={busy}
          disabled={busy}
          onClick={onToggle}
        />
        <a
          className="app-launch"
          href={app.home}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternal size={16} title={`Open ${app.name}`} />
        </a>
      </div>
    </li>
  );
}

/** A row for something PI can't talk to yet: lettermark, blurb, no switch. */
function SoonRow({ soon }: { soon: SoonApp }) {
  return (
    <li className="app-row is-soon">
      <span
        className="app-mark"
        style={{ background: soon.ink }}
        aria-hidden
      >
        {soon.lettermark}
      </span>
      <div className="app-copy">
        <h3 className="app-name">{soon.name}</h3>
        <p className="app-blurb">{soon.blurb}</p>
      </div>
      <div className="app-controls">
        <span className="soon-chip">coming soon</span>
      </div>
    </li>
  );
}
