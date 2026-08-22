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

export type ChatMeta = { id: string; title: string; at: number };

/** User-tweakable preferences; identity is never stored here. */
export type Prefs = { apps: AppKey[]; model: PiModel };

const DEFAULT_PREFS: Prefs = { apps: DEFAULT_APPS, model: "claude-opus-5" };

const prefsKey = (netid: string) => `pi:u:${netid}:prefs`;
const chatsKey = (netid: string) => `pi:u:${netid}:chats`;

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

export function upsertChat(netid: string, meta: ChatMeta) {
  const rest = getChats(netid).filter((c) => c.id !== meta.id);
  const next = [meta, ...rest].slice(0, 200);
  chatsCache.set(netid, next);
  localStorage.setItem(chatsKey(netid), JSON.stringify(next));
  emit();
}

export function removeChat(netid: string, id: string) {
  const next = getChats(netid).filter((c) => c.id !== id);
  chatsCache.set(netid, next);
  localStorage.setItem(chatsKey(netid), JSON.stringify(next));
  emit();
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
