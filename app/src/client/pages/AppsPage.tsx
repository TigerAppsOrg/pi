import { useEffect, useState } from "react";
import {
  PI_APPS,
  type AppKey,
  type PiSettings,
} from "../../shared/apps";
import { signOut, type Identity } from "../lib/auth";
import { useDesk } from "../lib/desk";
import { APP_INK } from "../lib/tools";
import { savePrefs } from "../lib/store";

export function AppsPage({
  identity,
  settings,
}: {
  identity: Identity;
  settings: PiSettings;
}) {
  const desk = useDesk(settings);
  const [saving, setSaving] = useState(false);
  const [callbackError] = useState(() => {
    const err = new URLSearchParams(location.search).get("error");
    if (err) history.replaceState(null, "", "/apps");
    return err;
  });

  // Reconcile connections on arrival so statuses and any pending Google
  // consent link are current, not left over from the last visit.
  useEffect(() => {
    void desk.ensureSetup().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk.settingsHash]);

  async function apply(next: PiSettings) {
    savePrefs(identity.netid, { apps: next.apps, model: next.model });
    setSaving(true);
    try {
      await desk.agent.ready;
      await desk.agent.call("setup", [next]);
    } catch (err) {
      console.warn("desk setup failed", err);
    } finally {
      setSaving(false);
    }
  }

  function toggleApp(key: AppKey) {
    const on = settings.apps.includes(key);
    const apps = on
      ? settings.apps.filter((a) => a !== key)
      : [...settings.apps, key];
    void apply({ ...settings, apps });
  }

  function statusFor(key: AppKey): { text: string; cls: string } {
    if (!settings.apps.includes(key)) return { text: "off", cls: "status" };
    if (desk.deskState?.authUrls?.[key]) {
      return { text: "one step left", cls: "status" };
    }
    const err = desk.deskState?.appErrors?.[key];
    if (err) return { text: `couldn't connect — ${err}`, cls: "status err" };
    if (key === "princetoncourses" && settings.apps.includes("junction")) {
      return { text: "covered by TigerJunction", cls: "status on" };
    }
    if (key === "gcal") {
      return desk.deskState?.gcalReady
        ? { text: "connected", cls: "status on" }
        : { text: saving ? "connecting…" : "on", cls: "status" };
    }
    // Engine connections open per turn, so "on" is the honest steady state.
    return { text: "on", cls: "status on" };
  }

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">My apps</h1>
        <p className="page-sub">
          Every switch is one TigerApp PI can{" "}
          <span className="hand">read and act on</span> — flip them anytime.
        </p>

        {callbackError && (
          <div className="conflict-note" style={{ marginBottom: 18 }}>
            <span className="lead">that didn't finish — </span>
            connecting Google Calendar failed: {callbackError}. Toggle it off
            and on to get a fresh link, then try again.
          </div>
        )}

        <div className="paper-card">
          <h3>Signed in</h3>
          <div className="field-row">
            <span className="avatar-lg" aria-hidden>
              {identity.netid.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <div style={{ fontWeight: 650 }}>{identity.name}</div>
              <div className="footnote" style={{ margin: 0 }}>
                {identity.netid} · {identity.email}
              </div>
            </span>
            <span style={{ flex: 1 }} />
            <button className="sched-tab" onClick={signOut}>
              Sign out
            </button>
          </div>
          <p className="footnote">
            PI is now connected with the TigerApps you've used in the past
          </p>
        </div>

        <div className="apps-grid">
          {PI_APPS.map((app) => {
            const on = settings.apps.includes(app.key);
            const status = statusFor(app.key);
            return (
              <div key={app.key} className="app-card">
                <div className="head">
                  <span
                    className="glyph has-logo"
                    style={{ background: APP_INK[app.key] }}
                  >
                    <img src={app.logo} alt="" />
                  </span>
                  <span>
                    <div className="aname">{app.name}</div>
                    <div className="atag">{app.tagline}</div>
                  </span>
                </div>
                <p className="adetail">{app.detail}</p>
                <div className="foot">
                  <span className={status.cls}>{status.text}</span>
                  {on && desk.deskState?.authUrls?.[app.key] && (
                    <a
                      className="connect-btn"
                      href={desk.deskState.authUrls[app.key]}
                    >
                      Connect with Google
                    </a>
                  )}
                  <button
                    className={on ? "toggle on" : "toggle"}
                    role="switch"
                    aria-checked={on}
                    aria-label={`${app.name} ${on ? "on" : "off"}`}
                    onClick={() => toggleApp(app.key)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="footnote" style={{ marginTop: 20 }}>
          Connections speak MCP to the TigerApps engine. New chats pick up
          whatever's switched on here; open chats follow along on your next
          message.
        </p>
      </div>
    </div>
  );
}
