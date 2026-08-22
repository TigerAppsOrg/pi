import { signIn } from "../lib/auth";

export function SignInPage() {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="mark" aria-hidden>
          <img src="/logos/tigerapps.png" alt="" />
          <span className="pi-badge">π</span>
        </div>
        <h1>
          Hello <span className="name swipe">tiger</span>,
        </h1>
        <p>
          PI is your Princeton desk — courses, schedules, ratings, and your
          degree, all in one chat.
        </p>
        <button className="new-chat signin-btn" onClick={signIn}>
          Sign in with Princeton
        </button>
        <p className="footnote">
          Princeton accounts only. Your netid comes straight from your
          @princeton.edu sign-in — nothing to type, nothing to fake.
        </p>
      </div>
    </div>
  );
}
