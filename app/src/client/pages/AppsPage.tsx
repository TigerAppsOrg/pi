import { useState } from "react";
import {
  PI_APPS,
  PI_MODELS,
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
    const err = desk.deskState?.appErrors?.[key];
    if (err) return { text: `couldn't connect — ${err}`, cls: "status err" };
    const server = desk.mcp?.servers?.[key];
    if (!settings.apps.includes(key)) return { text: "off", cls: "status" };
    if (server?.state === "ready" || server?.state === "connected") {
      return { text: "connected", cls: "status on" };
    }
    if (server?.state === "failed") {
      return { text: server.error ?? "connection failed", cls: "status err" };
    }
    return { text: saving ? "connecting…" : "on", cls: "status" };
  }

  return (
    <div className="page">
      <div className="page-inner">
        <h1 className="page-title">My apps</h1>
        <p className="page-sub">
          Every switch is one TigerApp PI can{" "}
          <span className="hand">read and act on</span> — flip them anytime.
        </p>

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
            Verified by Princeton sign-in — schedules, degree progress, and
            seat alerts are looked up under this netid.
          </p>
        </div>

        <div className="paper-card">
          <h3>Model</h3>
          <div className="seg" role="radiogroup" aria-label="Model">
            {PI_MODELS.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={settings.model === m.value}
                className={settings.model === m.value ? "active" : ""}
                onClick={() => void apply({ ...settings, model: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="footnote">
            Opus 5 is the default; Sonnet 5 is faster and cheaper. Both are
            Claude models and need the server's key — without one, PI falls
            back to Campus (Workers AI). You can also switch models right in
            the chat composer.
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
