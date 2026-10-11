/**
 * W75 (D75-1; spec §3 "Text atlas", §4): one MutationObserver per observed element, extended
 * to childList, characterData, subtree and the `style`/`class` attributes (with old values).
 *
 * liquiddom's own writes never count as a change (README Review Focus 2):
 * - Per (node, attribute), only the FIRST record of a batch is compared: its old value is the
 *   value before the batch, and it is compared with the value now. Every liquiddom write is
 *   synchronous inside one task (a class toggle, or the colour snapshot that lifts classes and
 *   writes `transition: none !important`, then restores the exact strings), so it lands in one
 *   batch and compares equal. Later records of the batch carry intermediate values and are skipped.
 * - `class` is compared with liquiddom's own classes removed (`liquid-element`, `liquid-text`,
 *   `liquid-halo`), so W74's text toggle and W75's halo toggle are invisible.
 * - Other attributes (`data-liquid-id`, `data-liquid-stack`) are not observed at all.
 *
 * Changes are only recorded in the callback; the runtime drains them once per frame (coalescing).
 */
import { AWAY_CLASS, ELEMENT_CLASS, HALO_CLASS, TEXT_CLASS } from "./stylesheet";

// W78 (D78-1): liquid-away is liquiddom's own too (no colour re-read or atlas re-render on a drag).
export const OWN_CLASSES: ReadonlySet<string> = new Set([ELEMENT_CLASS, TEXT_CLASS, HALO_CLASS, AWAY_CLASS]);

export const OBSERVER_INIT: MutationObserverInit = Object.freeze({
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["style", "class"],
  attributeOldValue: true,
});

export interface DomChange {
  /** The observed element's own `style` or `class` attribute changed: re-read colours (amendment B). */
  colour: boolean;
  /** Anything that can change the rendered text: text nodes, children, or a style/class change. */
  text: boolean;
}

export type MutationObserverFactory = (callback: MutationCallback) => MutationObserver;

const defaultFactory: MutationObserverFactory = (callback) => new MutationObserver(callback);
/** drain() with nothing pending (most frames) returns this, so an idle frame allocates no Map. */
const NO_CHANGES: ReadonlyMap<HTMLElement, DomChange> = new Map();

/** The class list without liquiddom's own classes, sorted, so order and own toggles never count. */
export function authorClasses(value: string | null): string {
  if (value === null) return "";
  return value
    .split(/\s+/)
    .filter((c) => c.length > 0 && !OWN_CLASSES.has(c))
    .sort()
    .join(" ");
}

function sameAuthorValue(name: string, before: string | null, now: string | null): boolean {
  if (name === "class") return authorClasses(before) === authorClasses(now);
  return (before ?? "") === (now ?? "");
}

export class ElementObserver {
  private readonly observers = new Map<HTMLElement, MutationObserver>();
  private readonly pending = new Map<HTMLElement, DomChange>();

  constructor(private readonly create: MutationObserverFactory = defaultFactory) {}

  get size(): number {
    return this.observers.size;
  }

  /** Idempotent. */
  observe(el: HTMLElement): void {
    if (this.observers.has(el)) return;
    const mo = this.create((records) => this.record(el, records));
    mo.observe(el, OBSERVER_INIT);
    this.observers.set(el, mo);
  }

  /** Idempotent; drops the element's pending change too. */
  unobserve(el: HTMLElement): void {
    const mo = this.observers.get(el);
    if (!mo) return;
    mo.disconnect();
    this.observers.delete(el);
    this.pending.delete(el);
  }

  disconnect(): void {
    for (const mo of this.observers.values()) mo.disconnect();
    this.observers.clear();
    this.pending.clear();
  }

  /** The changes since the last drain, one entry per element; clears them. */
  drain(): ReadonlyMap<HTMLElement, DomChange> {
    // Records queued but not delivered yet (a mutation earlier in this task) belong to this frame.
    for (const [el, mo] of this.observers) {
      const queued = mo.takeRecords();
      if (queued.length > 0) this.record(el, queued);
    }
    if (this.pending.size === 0) return NO_CHANGES;
    const out = new Map(this.pending);
    this.pending.clear();
    return out;
  }

  private record(el: HTMLElement, records: readonly MutationRecord[]): void {
    if (!this.observers.has(el)) return;
    let colour = false;
    let text = false;
    let firstSeen: Map<Node, Set<string>> | undefined; // allocated on the batch's first attribute record
    for (const r of records) {
      if (r.type !== "attributes") {
        text = true;
        continue;
      }
      const name = r.attributeName ?? "";
      firstSeen ??= new Map();
      let names = firstSeen.get(r.target);
      if (!names) {
        names = new Set<string>();
        firstSeen.set(r.target, names);
      }
      if (names.has(name)) continue; // only the batch's first record holds the pre-batch value
      names.add(name);
      const now = (r.target as Element).getAttribute(name);
      if (sameAuthorValue(name, r.oldValue, now)) continue;
      // Amendment B (D75-2): only the observed element's own class/style can change its own
      // background-color/color; a descendant's class/style re-renders the atlas only.
      if (r.target === el) colour = true;
      text = true;
    }
    if (!colour && !text) return;
    const prev = this.pending.get(el);
    this.pending.set(el, { colour: colour || (prev?.colour ?? false), text: text || (prev?.text ?? false) });
  }
}
