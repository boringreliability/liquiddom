/**
 * @vitest-environment jsdom
 * W82 (D82-1, D82-2): the stacking-context and opaque-background helpers. The two predicates are
 * pure over computed-style values (plain objects here); the DOM walks read jsdom's computed style
 * of inline declarations.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTAINER_STACKING_WARNING,
  OPAQUE_BACKGROUND_WARNING,
  canvasBlocker,
  describeElement,
  formsStackingContext,
  hasOwnBackground,
  isTransparentColor,
  opaqueAncestor,
  opaqueBackgroundWarning,
} from "../src/stacking";
import { ELEMENT_CLASS } from "../src/stylesheet";
import { resetDom } from "./_facade-helpers";

beforeEach(() => resetDom());
afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

describe("W82 stacking helpers (D82-1, D82-2)", () => {
  it("given_computed_styles_when_formsStackingContext_then_isolation_a_z_index_on_a_positioned_box_or_a_flex_item_opacity_transforms_and_the_other_triggers_form_one_and_a_plain_relative_box_does_not", () => {
    // D82-1: the container must be a stacking context; a positioned box alone is not one (W82.0 Q1d).
    expect(formsStackingContext({})).toBe(false);
    expect(formsStackingContext({ position: "relative", zIndex: "auto" })).toBe(false);
    expect(formsStackingContext({ position: "static", zIndex: "3" }), "z-index is inert on a static box").toBe(false);
    expect(formsStackingContext({ position: "relative", zIndex: "auto", isolation: "auto", opacity: "1", transform: "none" })).toBe(false);
    expect(formsStackingContext({ position: "relative", isolation: "isolate" })).toBe(true);
    expect(formsStackingContext({ position: "relative", zIndex: "0" })).toBe(true);
    expect(formsStackingContext({ position: "absolute", zIndex: "-2" })).toBe(true);
    expect(formsStackingContext({ position: "fixed" })).toBe(true);
    expect(formsStackingContext({ position: "sticky" })).toBe(true);
    expect(formsStackingContext({ zIndex: "1" }, "flex"), "a flex item with a z-index").toBe(true);
    expect(formsStackingContext({ zIndex: "1" }, "inline-grid")).toBe(true);
    expect(formsStackingContext({ zIndex: "1" }, "block")).toBe(false);
    expect(formsStackingContext({ opacity: "0.99" })).toBe(true);
    expect(formsStackingContext({ transform: "translateX(1px)" })).toBe(true);
    expect(formsStackingContext({ translate: "10px 0", rotate: "none", scale: "none" })).toBe(true);
    expect(formsStackingContext({ translate: "none", rotate: "none", scale: "none" })).toBe(false);
    expect(formsStackingContext({ filter: "blur(1px)" })).toBe(true);
    expect(formsStackingContext({ perspective: "100px" })).toBe(true);
    expect(formsStackingContext({ clipPath: "inset(0)" })).toBe(true);
    expect(formsStackingContext({ maskImage: "linear-gradient(red, blue)" })).toBe(true);
    expect(formsStackingContext({ backdropFilter: "blur(2px)" })).toBe(true);
    expect(formsStackingContext({ mixBlendMode: "multiply" })).toBe(true);
    expect(formsStackingContext({ willChange: "transform" })).toBe(true);
    expect(formsStackingContext({ willChange: "scroll-position, contents" })).toBe(false);
    expect(formsStackingContext({ willChange: "scroll-position, opacity" })).toBe(true);
    expect(formsStackingContext({ contain: "paint" })).toBe(true);
    expect(formsStackingContext({ contain: "style" })).toBe(false);
    expect(formsStackingContext({ containerType: "inline-size" })).toBe(true);
    expect(formsStackingContext({ containerType: "normal" })).toBe(false);
  });

  it("given_computed_colours_when_hasOwnBackground_then_any_alpha_above_0_or_an_image_counts_and_transparent_does_not_in_every_colour_syntax", () => {
    for (const t of ["", "transparent", "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)", "rgb(0 0 0 / 0)", "oklch(1 0 0 / 0)", "color(srgb 1 1 1 / 0%)", "rgba(10, 20, 30, 0.0)"]) {
      expect(isTransparentColor(t), t).toBe(true);
      expect(hasOwnBackground({ backgroundColor: t, backgroundImage: "none" }), t).toBe(false);
    }
    // W82.0 Q1b: html with any alpha already hides the liquid; Tailwind 4 serialises oklch().
    for (const c of ["rgb(244, 246, 251)", "rgba(244, 246, 251, 0.5)", "rgba(0, 0, 0, 0.01)", "oklch(1 0 0)", "oklch(0.98 0.01 250 / 0.4)", "#ffffff", "white"]) {
      expect(isTransparentColor(c), c).toBe(false);
      expect(hasOwnBackground({ backgroundColor: c }), c).toBe(true);
    }
    expect(hasOwnBackground({ backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "linear-gradient(red, blue)" }), "a gradient").toBe(true);
    expect(hasOwnBackground({ backgroundColor: "transparent", backgroundImage: 'url("a.png")' })).toBe(true);
    expect(hasOwnBackground({}), "jsdom: missing properties are the initial values").toBe(false);
  });

  it("given_a_dom_when_opaqueAncestor_walks_up_then_body_counts_only_when_html_has_a_background_an_opaque_wrapper_counts_the_stop_ends_the_walk_and_an_observed_element_is_skipped", () => {
    const wrap = document.body.appendChild(document.createElement("div"));
    wrap.className = "wrap";
    const box = wrap.appendChild(document.createElement("section"));
    const card = box.appendChild(document.createElement("article"));
    const el = card.appendChild(document.createElement("button"));
    document.body.style.backgroundColor = "rgb(244, 246, 251)";
    // Body only: its background propagates to the root canvas, below a z-index -1 canvas.
    expect(opaqueAncestor(el.parentElement, null)).toBeNull();
    expect(opaqueAncestor(document.body, null)).toBeNull();
    // html with its own background (any alpha): body's now paints over the canvas.
    document.documentElement.style.backgroundColor = "rgba(244, 246, 251, 0.5)";
    expect(opaqueAncestor(el.parentElement, null)).toBe(document.body);
    document.documentElement.style.backgroundColor = "";
    // An opaque wrapper, found from the element's parent; the walk stops at `stop` (the container).
    wrap.style.backgroundColor = "rgb(255, 255, 255)";
    expect(opaqueAncestor(el.parentElement, null)).toBe(wrap);
    expect(opaqueAncestor(el.parentElement, box), "the container's own background paints below its z-index -1 canvas").toBeNull();
    // An observed ancestor (.liquid-element) is liquid itself, never a blocker.
    wrap.style.backgroundColor = "";
    card.style.backgroundColor = "rgb(17, 24, 39)";
    expect(opaqueAncestor(el.parentElement, null)).toBe(card);
    card.classList.add(ELEMENT_CLASS);
    expect(opaqueAncestor(el.parentElement, null)).toBeNull();
    expect(opaqueAncestor(null, null)).toBeNull();
    // Fix round 1 (resolution 3, W82.0 Q1b "html only: works"): an opaque <html> with a transparent <body>
    // paints below the z-index -1 canvas, so nothing blocks (a guard at red: the stub answers null).
    card.style.backgroundColor = "";
    document.body.style.backgroundColor = "";
    document.documentElement.style.backgroundColor = "rgb(244, 246, 251)";
    expect(opaqueAncestor(el.parentElement, null), "html only").toBeNull();
  });

  it("given_a_container_or_the_body_when_canvasBlocker_then_a_stacking_context_container_and_a_page_without_an_opaque_body_pass_and_each_warning_names_the_fix", () => {
    const container = document.body.appendChild(document.createElement("div"));
    container.style.position = "relative";
    expect(canvasBlocker(container), "position: relative alone is no stacking context").toBe(CONTAINER_STACKING_WARNING);
    expect(CONTAINER_STACKING_WARNING).toContain("isolation: isolate");
    container.style.zIndex = "0";
    expect(canvasBlocker(container)).toBeNull();
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(canvasBlocker(undefined), "body alone").toBeNull();
    document.documentElement.style.backgroundColor = "rgb(255, 255, 255)";
    const msg = canvasBlocker(undefined);
    expect(msg).toBe(opaqueBackgroundWarning(document.body));
    expect(msg?.startsWith(`${OPAQUE_BACKGROUND_WARNING} <body>.`)).toBe(true);
    expect(msg).toContain("Make that background transparent, or give liquiddom a container with `isolation: isolate`.");
    const named = document.body.appendChild(document.createElement("main"));
    named.id = "app";
    named.className = `shell ${ELEMENT_CLASS} dark`;
    expect(describeElement(named), "liquiddom's own classes are left out").toBe("<main#app.shell.dark>");
    // Fix round 1 (guards at red: the stub answers null). Resolution 3: opaque <html> with a transparent <body> works.
    document.body.style.backgroundColor = "";
    expect(canvasBlocker(undefined), "html only").toBeNull();
    // A stacking-context container is fine on a fully opaque page (its canvas sits inside the container).
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    expect(canvasBlocker(container), "container on an opaque page").toBeNull();
  });
});
