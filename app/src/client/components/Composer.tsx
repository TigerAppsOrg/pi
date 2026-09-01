import { useEffect, useRef, useState } from "react";
import { IconSend, IconStop } from "./Icons";

const MAX_HEIGHT = 160;

export function Composer({
  onSend,
  onStop,
  busy,
  placeholder,
  initialText = "",
  accessory,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  /** Pre-filled draft (e.g. after a rewind). */
  initialText?: string;
  /** Small control rendered at the left edge, e.g. the model switcher. */
  accessory?: React.ReactNode;
}) {
  const [text, setText] = useState(initialText);
  /** True for a beat after Enter lands while PI is still writing. */
  const [blocked, setBlocked] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  useEffect(() => {
    if (initialText && ref.current) {
      ref.current.focus();
      grow(ref.current);
    }
  }, [initialText]);

  // The nudge is a one-shot; clear it so a second blocked Enter re-fires it.
  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), 900);
    return () => clearTimeout(t);
  }, [blocked]);

  function submit() {
    const t = text.trim();
    if (!t) return;
    // Mid-turn, the draft stays exactly where the student left it.
    if (busy) {
      setBlocked(true);
      return;
    }
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(t);
  }

  return (
    <div className="composer-wrap">
      <div className={`composer${blocked ? " blocked" : ""}`}>
        {accessory}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={
            busy ? "PI is still writing. Hit stop to cut in…" : placeholder
          }
          aria-label="Write to PI"
          onChange={(e) => {
            setText(e.target.value);
            grow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button
            className={`send stop${blocked ? " nudge" : ""}`}
            onClick={onStop}
          >
            <IconStop size={16} title="Stop this answer" />
          </button>
        ) : (
          <button className="send" onClick={submit} disabled={!text.trim()}>
            <IconSend size={17} title="Send" />
          </button>
        )}
      </div>
      <p className="sr-only" role="status">
        {blocked
          ? "PI is still writing. Your message is still in the box."
          : ""}
      </p>
      {/* "connects to" rather than "reads": one connection can carry another
          app's data (TigerJunction's scope covers course ratings and seat
          watches), so a promise about what PI reads would be one it breaks.
          "asks first" is a promise the server does keep: its system prompt
          requires a confirmed yes before ANY write, not just destructive
          ones (see the write rule in server/pi.ts). */}
      <p className="composer-note">
        PI only connects to the apps you&rsquo;ve switched on, and asks before
        it changes anything. It can still be wrong, so double-check what
        matters.
      </p>
    </div>
  );
}
