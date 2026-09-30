/**
 * Runtime content store.
 *
 * Resolution order for a key:  draft (staff preview) → value saved in Maestro → default from the registry.
 * The saved values are cached in localStorage so returning visitors render the edited content on the very
 * first paint (no flash of the defaults). The store is a tiny external store consumed with useSyncExternalStore.
 */

import { useSyncExternalStore } from "react";
import { maestro } from "@/maestro";
import { FIELD_MAP } from "./registry";

type Values = Record<string, unknown>;

const CACHE_KEY = "casanova.content.cache.v1";
export const DRAFT_KEY = "casanova.content.draft.v1";
/** Exported so the editor can clear the flag before opening a preview tab. */
export const PREVIEW_KEY = "casanova.preview";

const readJson = (storage: Storage | undefined, key: string): Values => {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as Values) : {};
  } catch {
    return {};
  }
};

let saved: Values = typeof localStorage !== "undefined" ? readJson(localStorage, CACHE_KEY) : {};
let draft: Values = typeof localStorage !== "undefined" ? readJson(localStorage, DRAFT_KEY) : {};
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Staff preview: the site shows the admin's unpublished draft. Enabled with ?maestro-preview=1 (kept for the tab session). */
let preview = false;
if (typeof window !== "undefined") {
  try {
    const flag = new URLSearchParams(window.location.search).get("maestro-preview");
    if (flag === "1") sessionStorage.setItem(PREVIEW_KEY, "1");
    if (flag === "0") sessionStorage.removeItem(PREVIEW_KEY);
    preview = sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    preview = false;
  }
}
export const previewEnabled = () => preview;

export function hasDraft(): boolean {
  return Object.keys(draft).length > 0;
}

export function getDraft(): Values {
  return draft;
}

export function setDraft(next: Values): void {
  draft = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage full / blocked: draft stays in memory only */
  }
  emit();
}

export function getSaved(): Values {
  return saved;
}

/** Raw value for a key, honouring preview draft, saved override and registry default. */
export function getRaw(key: string): unknown {
  if (previewEnabled() && key in draft) return draft[key];
  if (key in saved) return saved[key];
  const def = FIELD_MAP[key];
  if (!def && (import.meta.env as Record<string, unknown>).DEV) console.warn(`[content] unknown key: ${key}`);
  return def?.default;
}

/** Loads saved content from Maestro (one request) and refreshes the cache. */
export async function loadContent(): Promise<void> {
  const all = await maestro.content.all();
  saved = all;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  emit();
}

/** After Maestro Admin saves, update the local copy immediately. */
export function applySaved(values: Values, removedKeys: string[] = []): void {
  const next = { ...saved, ...values };
  for (const k of removedKeys) delete next[k];
  saved = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
  emit();
}

/** Non-React access to interface text (validators, prefilled messages):  ui("err.name"). */
export const ui = (name: string): string => {
  const v = getRaw(`ui.${name}`);
  return typeof v === "string" ? v : "";
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

if (typeof window !== "undefined") {
  // live preview: the admin tab writes the draft, every other tab picks it up immediately
  window.addEventListener("storage", (e) => {
    if (e.key === DRAFT_KEY) {
      draft = readJson(localStorage, DRAFT_KEY);
      emit();
    }
    if (e.key === CACHE_KEY) {
      saved = readJson(localStorage, CACHE_KEY);
      emit();
    }
  });
}

export const useContentVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);
