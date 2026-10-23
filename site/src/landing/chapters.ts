/** D86-2: the landing's nine chapters, in scroll order; `steps` names the acceptance-scene steps each one shows. */
export interface Chapter { readonly id: number; readonly title: string; readonly steps: string }

export const CHAPTERS: readonly Chapter[] = [
  { id: 0, title: "The DOM, but liquid.", steps: "wow" },
  { id: 1, title: "It's still a button.", steps: "1, 4" },
  { id: 2, title: "Poke it.", steps: "2, 3" },
  { id: 3, title: "Water, honey, jelly.", steps: "6" },
  { id: 4, title: "Grab it. Merge it.", steps: "5" },
  { id: 5, title: "Tilt your phone.", steps: "tilt" },
  { id: 6, title: "It follows you down.", steps: "7" },
  { id: 7, title: "Calm when you need it.", steps: "8" },
  { id: 8, title: "Pour it into your app.", steps: "CTA" },
];
