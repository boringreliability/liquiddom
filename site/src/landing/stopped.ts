import { STOPPED_MESSAGE } from "./config";

/** D86-3: an instance stopped; hide every control that drives the liquid and say so once. */
export function showStopped(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-liquid-control]")) el.hidden = true;
  const line = root.querySelector<HTMLElement>("[data-liquid-stopped]");
  if (line) {
    line.textContent = STOPPED_MESSAGE;
    line.hidden = false;
  }
}
