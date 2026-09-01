import { useEffect, useState } from "react";
import { PI_APPS } from "../../shared/apps";
import { PiMark } from "../components/Icons";
import { signIn } from "../lib/auth";

/**
 * Human copy for anything the sign-in round trip can hand back. The Worker
 * still answers some failures with a plain text page; this covers the cases
 * that come back as a query param, and gives the rest a kind default.
 */
const SIGNIN_TROUBLE: Record<string, string> = {
  access_denied: "You backed out of the Princeton sign-in. Nothing happened.",
  expired: "That sign-in attempt sat too long. Start it again.",
  state: "That sign-in attempt got out of step. Start it again.",
  domain: "PI is for princeton.edu accounts. Try again with your NetID.",
  config: "PI's sign-in is misconfigured right now. TigerApps has been told.",
};

/** Reads ?error= once, then scrubs it so a refresh doesn't replay it. */
function useSignInTrouble(): string | null {
  const [trouble, setTrouble] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("error");
    if (!code) return;
    params.delete("error");
    params.delete("error_description");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
    setTrouble(
      SIGNIN_TROUBLE[code] ?? "Princeton's sign-in didn't finish. Try once more."
    );
  }, []);
  return trouble;
}

export function SignInPage({
  unreachable = false,
  onRetry,
}: {
  /** /auth/me never answered: say so instead of implying a sign-out. */
  unreachable?: boolean;
  onRetry?: () => void;
}) {
  const trouble = useSignInTrouble();

  return (
    <main className="signin">
      <div className="signin-card">
        <span className="pi-lozenge pi-lozenge-lg signin-mark">
          <PiMark size={30} title="PI" />
        </span>
        <p className="eyebrow">Princeton Intelligence</p>
        <h1>
          Ask once. PI <span className="swipe">reads the rest</span>.
        </h1>
        <p className="lede">
          Course reviews, your schedule, what's left on your degree. PI reads
          the TigerApps you switch on, and nothing else.
        </p>

        <ul className="signin-asks">
          <li>“which COS courses do people actually rate well?”</li>
          <li>“does anything on my schedule clash on Tuesdays?”</li>
        </ul>

        <p className="signin-appslabel">apps you can switch on</p>
        <ul className="signin-apps">
          {PI_APPS.map((app) => (
            <li
              key={app.key}
              className="hall-tag"
              style={{ ["--tag-color" as string]: `var(--hl-${app.ink})` }}
            >
              {app.name}
            </li>
          ))}
        </ul>

        {trouble && (
          <p className="signin-trouble" role="status">
            {trouble}
          </p>
        )}

        {unreachable ? (
          <>
            <p className="signin-trouble" role="status">
              PI can't reach the desk right now. That's on us, not on your
              sign-in.
            </p>
            <button className="btn btn-ink signin-btn" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <button className="btn btn-ink signin-btn" onClick={() => signIn()}>
            Continue with your NetID
          </button>
        )}

        <p className="privacy">
          PI only reads the TigerApps you switch on. Google Calendar stays
          read-only, and only after you say yes.
        </p>
        <p className="footnote">
          princeton.edu accounts only. Your NetID comes straight from the
          Princeton sign-in, so there is nothing to type and nothing to fake.
        </p>
        <p className="colophon">
          <a href="https://tigerapps.org" target="_blank" rel="noreferrer">
            made by TigerApps
          </a>
        </p>
      </div>
    </main>
  );
}
