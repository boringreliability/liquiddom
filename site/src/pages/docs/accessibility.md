---
layout: ../../layouts/DocsLayout.astro
title: Accessibility
description: What liquiddom changes for assistive technology, keyboards, reduced motion, print and forced colours, and what it never changes.
---

liquiddom paints; it never replaces an element. The button you observe is still the button in the accessibility tree, with its role, name, focus and events. The liquid is decoration on a canvas under it.

## The canvas is invisible to assistive technology

The canvas is `aria-hidden="true"` and `pointer-events: none`. Screen readers never meet it, and every click, tap and hover reaches your elements as before. liquiddom adds no roles, labels or tab stops.

## Focus and the keyboard

- Focus rings are the browser's own and paint above the liquid.
- Activating an observed button or link from the keyboard (Enter, or Space on a button) splashes it from its centre. The native activation is never prevented: the button still submits, the link still navigates.
- The keyboard never drags an element.

## Reduced motion

When the visitor asks for reduced motion (`prefers-reduced-motion: reduce`, or `forceReducedMotion: true`), the liquid is still and crisp: every element rests in its exact shape, its DOM text is fully visible, and splashes, shakes, the pointer, drag and gravity are ignored. Every control keeps working; `splash()` and `shake()` still validate their arguments. A change of the OS setting applies at once.

## Print and forced colours

Printing and Windows' high-contrast mode (`forced-colors: active`) hide the canvas, and every observed element shows its own background, border and text again. liquiddom's styles live in a `@layer liquiddom` scoped to `screen` and `forced-colors: none`, so they never reach a printout.

## Text and contrast

The liquid takes each element's `background-color` and the text stays your DOM text, so the contrast you designed is the contrast at rest. With WebGPU the text flows with the liquid while it moves and is crisp DOM text again once it rests. With Canvas2D the text never moves; while an element moves its text gets a faint halo in the element's own background colour, so it stays readable.

## Touch and long-press

On touch, a drag starts after a 350 ms hold; a tap is a normal click and a swipe still scrolls. While a finger holds a draggable element, its long-press menu and the iOS callout are suppressed. Observe text fields, inputs and `contenteditable` elements with `{ drag: false }`: they keep the browser's own long-press behaviour, including text selection.
