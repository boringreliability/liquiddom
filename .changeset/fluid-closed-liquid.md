---
"liquiddom": patch
---

Shake and splash keep the liquid closed. The default stretch yield rises (cohesion 0.5 now maps to 0.46, the range is 0.02–0.90) and the shake profile amplitude drops to 0.35, so wide elements thin instead of tearing into a lace. The kernel radius follows the particle spacing up to 16 px (was 8 px), so a splash no longer leaves specks in a neighbouring element on pages with a large observed area; the Canvas2D density grid coarsens with it to keep its cost flat. The honey preset re-forms within 3 s.
