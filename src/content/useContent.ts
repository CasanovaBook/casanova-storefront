import { useMemo } from "react";
import { getRaw, useContentVersion } from "./store";

/** Replaces {placeholders} in a text: fmt("{n} ספרים", { n: 3 }). */
export function fmt(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface LinkItem {
  label: string;
  to: string;
}

/** Text of a key ("" when empty). */
function text(key: string): string {
  const v = getRaw(key);
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function strings(key: string): string[] {
  const v = getRaw(key);
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function list<T = Record<string, string>>(key: string): T[] {
  const v = getRaw(key);
  return Array.isArray(v) ? (v as T[]) : [];
}

/** "label|/path" per line → links. */
export function parseLinks(raw: string): LinkItem[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, to] = l.split("|");
      return { label: (label ?? "").trim(), to: (to ?? "#").trim() };
    })
    .filter((l) => l.label);
}

/**
 * The content accessor. Call it once in a component:  const c = useContent();
 *   c("home.hero.title")            → string
 *   c.strings("lists.productTypes") → string[]
 *   c.list<Item>("home.features.items") → typed rows
 * The component re-renders automatically when content changes (admin save, live preview).
 */
export function useContent() {
  const version = useContentVersion();
  return useMemo(() => Object.assign((key: string) => text(key), { strings, list, raw: getRaw }), [version]);
}

export type Content = ReturnType<typeof useContent>;
