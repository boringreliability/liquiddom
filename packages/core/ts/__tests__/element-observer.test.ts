/**
 * @vitest-environment jsdom
 * W75 (D75-1, README Review Focus 2): one MutationObserver per observed element; liquiddom's
 * own class toggles and the colour snapshot's attribute round trip never count; changes are
 * coalesced until the runtime drains them once per frame.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElementObserver, authorClasses, OBSERVER_INIT, OWN_CLASSES } from "../src/element-observer";
import { snapshotColorsWithout } from "../src/color";
import { AWAY_CLASS, ELEMENT_CLASS, HALO_CLASS, HALO_ID_ATTR, STACK_ATTR, TEXT_CLASS } from "../src/stylesheet";

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
let obs: ElementObserver;

function element(): HTMLElement {
  const el = document.createElement("button");
  el.className = `btn ${ELEMENT_CLASS}`;
  el.textContent = "Splash";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  obs = new ElementObserver();
});
afterEach(() => obs.disconnect());

describe("W75: ElementObserver (D75-1)", () => {
  it("given_an_author_class_change_when_drained_then_one_entry_with_colour_and_text_D75_1", async () => {
    expect(OBSERVER_INIT).toEqual({
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
      attributeOldValue: true,
    });
    const el = element();
    obs.observe(el);
    obs.observe(el); // idempotent
    expect(obs.size).toBe(1);
    el.classList.add("active");
    await flush();
    const changes = obs.drain();
    expect([...changes.keys()]).toEqual([el]);
    expect(changes.get(el)).toEqual({ colour: true, text: true });
  });

  // W78 red: approved-test change (D78-1, see ward-078.md): liquiddom's own classes include liquid-away,
  // so the drag label's toggles never re-snapshot colours or re-render the atlas (W75 RF2).
  it("given_only_liquiddom_class_toggles_when_drained_then_no_entry_and_authorClasses_drops_own_classes_RF2", async () => {
    expect([...OWN_CLASSES].sort()).toEqual([AWAY_CLASS, ELEMENT_CLASS, HALO_CLASS, TEXT_CLASS].sort());
    expect(authorClasses(`b a ${ELEMENT_CLASS}  ${TEXT_CLASS} ${HALO_CLASS} ${AWAY_CLASS}`)).toBe("a b");
    expect(authorClasses(null)).toBe("");
    const el = element();
    obs.observe(el);
    el.classList.add(TEXT_CLASS);
    el.classList.add(HALO_CLASS);
    el.classList.remove(TEXT_CLASS);
    el.classList.remove(HALO_CLASS);
    el.classList.add(TEXT_CLASS);
    el.classList.add(AWAY_CLASS);
    el.classList.remove(AWAY_CLASS);
    await flush();
    expect(obs.drain().size).toBe(0);
  });

  it("given_a_refresh_snapshot_round_trip_of_class_and_style_when_drained_then_no_entry_RF2", async () => {
    const style = document.createElement("style");
    style.textContent = `.btn { background-color: rgb(9, 8, 7); color: rgb(1, 2, 3); } .${ELEMENT_CLASS} { background-color: transparent !important; } .${TEXT_CLASS}, .${TEXT_CLASS} * { -webkit-text-fill-color: transparent !important; }`;
    document.head.appendChild(style);
    const el = element();
    el.classList.add(TEXT_CLASS);
    el.setAttribute("style", "--probe:  1 ;transition: background-color 2s");
    obs.observe(el);
    const before = [el.getAttribute("class"), el.getAttribute("style")];
    // The snapshot lifts liquid-element and writes `transition: none !important` for the read.
    expect(snapshotColorsWithout(el, ELEMENT_CLASS)).toEqual({ background: [9, 8, 7, 1], text: [1, 2, 3, 1] });
    expect([el.getAttribute("class"), el.getAttribute("style")]).toEqual(before);
    await flush();
    expect(obs.drain().size, "only the batch's first old value counts, and it equals the value now").toBe(0);
  });

  it("given_characterData_and_childList_mutations_in_the_subtree_when_drained_then_a_text_only_entry", async () => {
    const el = element();
    const span = el.appendChild(document.createElement("span"));
    span.textContent = "!";
    obs.observe(el);
    (el.firstChild as Text).data = "Splosh"; // characterData
    span.append("?"); // childList in the subtree
    await flush();
    expect(obs.drain().get(el)).toEqual({ colour: false, text: true });
  });

  it("given_many_mutations_in_one_frame_when_drained_twice_then_one_entry_then_none_even_before_the_callback_ran", () => {
    const el = element();
    obs.observe(el);
    for (let i = 0; i < 10; i++) el.append(String(i));
    el.classList.add("active");
    // No flush: drain() also takes the records the browser has not delivered yet.
    const first = obs.drain();
    expect(first.size).toBe(1);
    expect(first.get(el)).toEqual({ colour: true, text: true });
    expect(obs.drain().size).toBe(0);
  });

  // W75 amendment B (approved by Dennis 2026-10-10): this test (#6) was
  // "given_a_descendant_class_or_style_change_when_drained_then_a_colour_entry_for_the_observed_element"
  // and expected { colour: true, text: true }. D75-2 amended B: a descendant's class/style cannot change
  // the element's own background/colour, so it re-renders the atlas only (text dirty, no colour re-read).
  it("given_a_descendant_class_or_style_change_when_drained_then_a_text_only_entry_for_the_observed_element_B2", async () => {
    const el = element();
    const span = el.appendChild(document.createElement("span"));
    obs.observe(el);
    span.className = "accent";
    await flush();
    expect(obs.drain().get(el)).toEqual({ colour: false, text: true });
    span.style.color = "red";
    await flush();
    expect(obs.drain().get(el)).toEqual({ colour: false, text: true });
  });

  it("given_the_observed_elements_own_class_or_style_change_alone_or_with_a_descendant_change_when_drained_then_colour_and_text_B2", async () => {
    const el = element();
    const span = el.appendChild(document.createElement("span"));
    obs.observe(el);
    el.style.setProperty("--tone", "1"); // own style
    await flush();
    expect(obs.drain().get(el)).toEqual({ colour: true, text: true });
    span.className = "accent"; // descendant class ...
    el.classList.add("active"); // ... and own class in the same frame: the own change wins
    await flush();
    expect(obs.drain().get(el)).toEqual({ colour: true, text: true });
    span.className = "accent2"; // descendant again, own class toggled by liquiddom only
    el.classList.add(TEXT_CLASS);
    await flush();
    expect(obs.drain().get(el), "liquiddom's own class toggle never makes a descendant change a colour change").toEqual({ colour: false, text: true });
  });

  it("given_unobserve_or_disconnect_when_mutated_afterwards_then_nothing_is_pending_and_both_are_idempotent", async () => {
    const a = element();
    const b = element();
    obs.observe(a);
    obs.observe(b);
    a.classList.add("x");
    obs.unobserve(a); // drops a's pending change too
    obs.unobserve(a);
    a.classList.add("y");
    await flush();
    expect(obs.drain().size).toBe(0);
    b.append("z");
    obs.disconnect();
    obs.disconnect();
    b.append("w");
    await flush();
    expect(obs.drain().size).toBe(0);
    expect(obs.size).toBe(0);
  });

  it("given_data_liquid_id_or_data_liquid_stack_writes_when_drained_then_no_entry", async () => {
    const el = element();
    obs.observe(el);
    el.setAttribute(HALO_ID_ATTR, "h9");
    el.setAttribute(STACK_ATTR, "relative");
    el.setAttribute("aria-pressed", "true");
    await flush();
    expect(obs.drain().size).toBe(0);
  });
});
