import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice dictation for the composer, on the browser's own speech recognition
 * (Chrome, Edge, Safari). Nothing is sent to PI's server: the browser turns
 * speech into text and the composer receives it as a draft the student can
 * still edit before sending. Where the browser has no recognizer (Firefox),
 * `supported` is false and the composer simply doesn't offer a mic.
 */

/**
 * The slice of the Web Speech API this uses. TypeScript's DOM lib ships the
 * result types but not the recognizer itself, which is still prefixed in
 * Chromium and Safari.
 */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

function recognizer(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * The draft as it should read with `spoken` added after what the student had
 * already typed. Typed text is never rewritten, only continued.
 */
export function joinDictation(typed: string, spoken: string): string {
  const said = spoken.replace(/\s+/g, " ").trim();
  if (!said) return typed;
  if (!typed.trim()) return said;
  return /\s$/.test(typed) ? `${typed}${said}` : `${typed} ${said}`;
}

/** Everything heard this session, final and still-settling alike. */
export function transcriptOf(results: ArrayLike<ArrayLike<{ transcript: string }>>): string {
  let text = "";
  for (let i = 0; i < results.length; i++) {
    text += results[i][0]?.transcript ?? "";
  }
  return text;
}

/** What a student can do about each recognizer failure, in PI's words. */
export function dictationProblem(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Your browser is blocking the microphone for PI.";
    case "audio-capture":
      return "PI couldn't find a microphone.";
    case "network":
      return "Dictation needs an internet connection.";
    // Silence and a deliberate stop aren't problems worth a sentence.
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Dictation stopped. Try the mic again.";
  }
}

export function useDictation(onText: (spoken: string) => void) {
  const [supported] = useState(() => recognizer() !== null);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const active = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const start = useCallback(() => {
    const Ctor = recognizer();
    if (!Ctor || active.current) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      // A cancelled session can still deliver a late result; drop it so it
      // can't refill a draft that was just sent.
      if (active.current !== rec) return;
      onTextRef.current(transcriptOf(event.results));
    };
    rec.onerror = (event) => {
      if (active.current !== rec) return;
      setProblem(dictationProblem(event.error));
    };
    rec.onend = () => {
      if (active.current !== rec) return;
      active.current = null;
      setListening(false);
    };
    active.current = rec;
    setProblem(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      active.current = null;
      setListening(false);
      setProblem(dictationProblem(""));
    }
  }, []);

  /** Finish listening and keep what was heard. */
  const stop = useCallback(() => {
    active.current?.stop();
  }, []);

  /** Stop at once and discard anything still in flight (used on send). */
  const cancel = useCallback(() => {
    const rec = active.current;
    if (!rec) return;
    active.current = null;
    setListening(false);
    rec.abort();
  }, []);

  useEffect(
    () => () => {
      const rec = active.current;
      active.current = null;
      rec?.abort();
    },
    []
  );

  return { supported, listening, problem, start, stop, cancel };
}
