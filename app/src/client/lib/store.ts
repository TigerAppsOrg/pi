import { useSyncExternalStore } from "react";
import {
  DEFAULT_APPS,
  type AppKey,
  type PiModel,
  type PiSettings,
} from "../../shared/apps";

/**
 * Browser-local stores, namespaced per signed-in netid so a shared machine
 * never mixes people's chat lists or preferences. Identity itself comes from
 * the Worker session (see lib/auth.ts) — nothing here decides who you are.
 */

export type ChatMeta = {
  id: string;
  title: string;
  at: number;
  /** Set by the sidebar's star toggle. Absent on every chat saved before it. */
  starred?: boolean;
};

/**
 * The one conversation every student already has. It is a plain constant, not
 * a minted id, so it survives a cache clear and points at the same Durable
 * Object on every device.
 */
export const GENERAL_CHAT_ID = "general";
export const GENERAL_CHAT_TITLE = "PI general chat";

/** User-tweakable preferences; identity is never stored here. */
export type Prefs = { apps: AppKey[]; model: PiModel };

const DEFAULT_PREFS: Prefs = { apps: DEFAULT_APPS, model: "claude-opus-5" };

const prefsKey = (netid: string) => `pi:u:${netid}:prefs`;
const chatsKey = (netid: string) => `pi:u:${netid}:chats`;
const stashKey = (netid: string) => `pi:u:${netid}:appstash`;
const notesKey = (netid: string) => `pi:u:${netid}:notes`;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("pi:u:")) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

const prefsCache = new Map<string, Prefs>();
const chatsCache = new Map<string, ChatMeta[]>();

function getPrefs(netid: string): Prefs {
  if (!prefsCache.has(netid)) {
    try {
      const raw = localStorage.getItem(prefsKey(netid));
      prefsCache.set(
        netid,
        raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
      );
    } catch {
      prefsCache.set(netid, DEFAULT_PREFS);
    }
  }
  return prefsCache.get(netid)!;
}

function getChats(netid: string): ChatMeta[] {
  if (!chatsCache.has(netid)) {
    try {
      chatsCache.set(
        netid,
        JSON.parse(localStorage.getItem(chatsKey(netid)) ?? "[]")
      );
    } catch {
      chatsCache.set(netid, []);
    }
  }
  return chatsCache.get(netid)!;
}

export function savePrefs(netid: string, next: Prefs) {
  prefsCache.set(netid, next);
  localStorage.setItem(prefsKey(netid), JSON.stringify(next));
  emit();
}

function writeChats(netid: string, next: ChatMeta[]) {
  chatsCache.set(netid, next);
  localStorage.setItem(chatsKey(netid), JSON.stringify(next));
  emit();
}

export function upsertChat(netid: string, meta: ChatMeta) {
  const current = getChats(netid);
  const prev = current.find((c) => c.id === meta.id);
  const rest = current.filter((c) => c.id !== meta.id);
  // Callers that only know {id, title, at} must not silently unstar a row.
  writeChats(netid, [{ ...prev, ...meta }, ...rest].slice(0, 200));
}

/** Adds a row only if it isn't there yet. Unlike upsertChat, never reorders. */
export function ensureChat(netid: string, meta: ChatMeta) {
  const current = getChats(netid);
  if (current.some((c) => c.id === meta.id)) return;
  writeChats(netid, [meta, ...current].slice(0, 200));
}

export function removeChat(netid: string, id: string) {
  writeChats(
    netid,
    getChats(netid).filter((c) => c.id !== id)
  );
}

/** Star or unstar a chat, so it sits in the sidebar's Starred section. */
export function toggleStar(netid: string, id: string) {
  writeChats(
    netid,
    getChats(netid).map((c) =>
      c.id === id ? { ...c, starred: !c.starred } : c
    )
  );
}

/**
 * What was switched on before the master switch turned everything off. It
 * outlives the page that wrote it: My apps is a lazily-mounted route, and a
 * stash held in a ref would be gone the moment the student walked to another
 * page — leaving nothing to restore but "all of them", which would switch on
 * apps they never picked.
 */
export function readAppStash(netid: string): AppKey[] {
  try {
    const raw = localStorage.getItem(stashKey(netid));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as AppKey[]) : [];
  } catch {
    return [];
  }
}

export function writeAppStash(netid: string, apps: AppKey[]) {
  try {
    localStorage.setItem(stashKey(netid), JSON.stringify(apps));
  } catch {
    /* a lost stash costs a re-pick, not correctness */
  }
}

/** The day (YYYY-MM-DD) the home notes were last dismissed, if ever. */
export function readNotesDismissed(netid: string): string | null {
  try {
    return localStorage.getItem(notesKey(netid));
  } catch {
    return null;
  }
}

export function dismissNotes(netid: string, day: string) {
  try {
    localStorage.setItem(notesKey(netid), day);
  } catch {
    /* the note simply comes back */
  }
}

export function usePrefs(netid: string): Prefs {
  return useSyncExternalStore(subscribe, () => getPrefs(netid));
}

export function useChats(netid: string): ChatMeta[] {
  return useSyncExternalStore(subscribe, () => getChats(netid));
}

/** The wire settings a Pi agent instance expects. */
export function toSettings(netid: string, prefs: Prefs): PiSettings {
  return { netid, apps: prefs.apps, model: prefs.model };
}

export function newChatId(): string {
  return crypto.randomUUID().slice(0, 13);
}

/**
 * How a chat's `at` reads on its sidebar row: a clock time today, a weekday
 * inside the last week, a date beyond that. Short enough to sit at the end of
 * a 264px row without pushing the title out.
 */
export function formatChatTime(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const then = new Date(at);
  const today = new Date(now);
  const days = Math.round(
    (startOfDay(today) - startOfDay(then)) / 86_400_000
  );
  if (days <= 0) {
    return now - at < 60_000
      ? "just now"
      : then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (days === 1) return "yesterday";
  if (days < 7) return then.toLocaleDateString([], { weekday: "short" });
  const sameYear = then.getFullYear() === today.getFullYear();
  return then.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
