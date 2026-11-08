# DESIGN.md · Bannuar HR portal

The portal shares the website's identity (see the website's DESIGN.md) and sets it for daily office
work. Every decision has its reason in one line.

| Decision | Reason |
|---|---|
| Night sidebar (`#0b1626`), light workspace (`#f6f3ec`), white panels | The badge's night as the frame; long reading and data entry on a light ground |
| One accent, Bannuar red (`#c4161c`), for the main action on each screen | The eye finds the one thing to do; everything else is secondary or plain |
| The gold beacon marks the active section, the toast and empty states | The identity motif of the website: one light, one guard on duty |
| Archivo in two widths: expanded headings, condensed labels, normal body | One family like a uniform; the same face as the website |
| Status colours with fixed meanings: green done, gold waiting, red needs action or declined, blue information, grey closed | Staff read the state of a request without reading the word; every tone passes 4.5:1 on its tint |
| Dense tables with a sticky header, one row per person or request | 4,000 employees: lists must scan quickly; details open on their own page or in a dialog |
| Every list has loading, empty and error states; every form shows errors under its field | Nothing looks finished while it is still loading or broken (anti-slop R-27) |
| Native `<dialog>` for forms and confirmations | Escape closes, focus stays inside, and it works without a library |
| Two-step focus halo (white then red) on every control | Keyboard users always see where they are (R-32) |
| Messages written for people, including the database's own refusals | "There is already leave filed on some of these days" beats an error code |
| No glass, no gradients except the sunrise on the sign-in screen | A working tool: the one atmospheric moment greets people at sign-in |
