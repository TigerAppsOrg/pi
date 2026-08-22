import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText && ref.current) {
      ref.current.focus();
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 160)}px`;
    }
  }, [initialText]);

  function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(t);
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        {accessory}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="Message PI"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button className="send stop" onClick={onStop} aria-label="Stop">
            ■
          </button>
        ) : (
          <button
            className="send"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send"
          >
            ↑
          </button>
        )}
      </div>
      <p className="composer-note">
        PI reads your TigerApps with your OK — it never changes anything
        without asking first.
      </p>
    </div>
  );
}
