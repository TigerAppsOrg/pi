import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type PiSettings } from "../../shared/apps";

/**
 * Browser-local stores for settings and the chat list. Identity is a dev
 * stub for now — when EntraID auth lands, `settings.netid` gets replaced by
 * the authenticated principal and everything downstream stays the same.
 */

export type ChatMeta = { id: string; title: string; at: number };

const SETTINGS_KEY = "pi:settings";
const CHATS_KEY = "pi:chats";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: Listener) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY || e.key === CHATS_KEY) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

let settingsCache: PiSettings | null = null;
let chatsCache: ChatMeta[] | null = null;

function getSettings(): PiSettings {
  if (settingsCache == null) {
    const s = read(SETTINGS_KEY, DEFAULT_SETTINGS);
    // Migrate pre-switcher model values.
    const legacy = s.model as string;
    if (legacy === "auto" || legacy === "claude") s.model = "claude-opus-5";
    settingsCache = s;
  }
  return settingsCache;
}

function getChats(): ChatMeta[] {
  if (chatsCache == null) {
    try {
      chatsCache = JSON.parse(localStorage.getItem(CHATS_KEY) ?? "[]");
    } catch {
      chatsCache = [];
    }
  }
  return chatsCache!;
}

export function saveSettings(next: PiSettings) {
  settingsCache = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  emit();
}

export function upsertChat(meta: ChatMeta) {
  const rest = getChats().filter((c) => c.id !== meta.id);
  chatsCache = [meta, ...rest].slice(0, 200);
  localStorage.setItem(CHATS_KEY, JSON.stringify(chatsCache));
  emit();
}

export function removeChat(id: string) {
  chatsCache = getChats().filter((c) => c.id !== id);
  localStorage.setItem(CHATS_KEY, JSON.stringify(chatsCache));
  emit();
}

export function useSettings(): PiSettings {
  return useSyncExternalStore(subscribe, getSettings);
}

export function useChats(): ChatMeta[] {
  return useSyncExternalStore(subscribe, getChats);
}

export function newChatId(): string {
  return crypto.randomUUID().slice(0, 13);
}
