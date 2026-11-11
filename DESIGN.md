# Bannuar HR portal: design

## What it is for

The desk where Bannuar Security Agency's HR, payroll and operations staff keep a few thousand guards
posted, papered and paid: who is at which post, whose license runs out, which leave waits for a
decision, what each cutoff pays. People use it all day on office laptops (1280 to 1440 wide) and now
and then on a phone. So it is a working tool first: clear, quick to scan, nothing in the way.

Its character comes from the trade. Guards keep watch around the clock, in two shifts, at posts
across La Union. The portal is the watch room for that work: a night sidebar like the guardhouse,
a lit work surface, one gold lamp that marks where you are, one red signal for the action that
matters.

## Direction: the watch room

| Element | Decision | Why |
|---|---|---|
| Night (`#0b1626`) | The sidebar, the hero of the sign-in page, tooltips, the dark tiles | The badge's own night; the frame of the room |
| Paper (`#f6f3ec`) and white panels | The work surface | Long reading of names and numbers; the 201 file and the ledger |
| Beacon gold (`#f2c230`) | Only where something is live or current: the active page, the current time, the today line | A lamp is lit where someone is on duty, nowhere else |
| Signal red (`#c4161c`) | The one main action on a screen, counts that wait for a decision, focus | An action reads at once because nothing else is red |
| Archivo, variable width | Headings set wide (110 to 120%), labels narrow (78%) and small caps, body at normal width; tabular figures in tables only | One family with the range of a guard's register: stamped headings, ledger columns |

The badge is always Bannuar's own picture file, never redrawn.

## The signature: the duty clock

The sign-in page holds the one large visual: a 24-hour dial of the two duties (6 AM to 6 PM and
6 PM to 6 AM, the shifts the pay rules use), the badge at its centre and a gold lamp at the real
time in Manila, moving with the clock. It leans a few degrees towards the pointer. It says what
the agency does, without a stock photograph or an invented number. Under reduced motion it is
still; the time still reads.

## Kept from the first design

| Decision | Reason |
|---|---|
| Status colours with fixed meanings: green done, gold waiting, red needs action or declined, blue information, grey closed | Staff read the state of a request without reading the word; every tone passes 4.5:1 on its tint |
| Dense tables with a sticky header, one row per person or request | 4,000 employees: lists must scan quickly; details open on their own page or in a dialog |
| Every list has loading, empty and error states; every form shows errors under its field | Nothing looks finished while it is still loading or broken |
| Native `<dialog>` for forms and confirmations | Escape closes, focus stays inside, and it works without a library |
| Messages written for people, including the database's own refusals | "There is already leave filed on some of these days" beats an error code |

Changed in this overhaul: glass is now allowed in exactly two places (below), the sign-in sunrise
became the duty clock, and the dashboard is arranged around what waits for a decision.

## System

- **Radius:** 6 px for small marks (badges, keys), 10 px for controls, 16 px for panels and tiles,
  22 px for the sign-in card. No pills except counts.
- **Elevation:** panels sit flat on a hairline. Only things that float above the page carry a
  shadow: dialogs, popovers, tooltips, toasts, the open menu on a phone.
- **Glass:** two places, and only there: the top bar (content scrolls under it) and the scrim
  behind a dialog. Everything else is solid, so text never sits on a blur.
- **Glow:** the gold lamp of the active page and the main button's hover. Nothing else glows.
- **Buttons:** one main style (signal red, a light that follows the pointer across it, a press that
  sinks it by 1.5%, never a jump), one line style, one ghost. Focus is a red ring with a soft halo,
  the same on every control, never removed.
- **Spacing:** 4 px steps; 16 to 24 px inside panels, 28 px between page blocks.

## Motion (it serves a purpose, or it does not run)

| Motion | Purpose | Length |
|---|---|---|
| Page change: the work area cross-fades and settles 6 px | Shows the page changed without hiding the menu | 220 ms |
| The menu's lamp slides to the page you open | Shows where you went, from where | 320 ms |
| Tab underline slides between tabs | Same, inside a page | 240 ms |
| Headline numbers count up once when the dashboard loads | Draws the eye to the figures, then stops | 700 ms |
| Buttons: the light follows the pointer; press sinks | The control answers the hand | 150 to 350 ms |
| Dialogs scale in from 98% over a blurred scrim | Lifts the task above the page | 240 ms |
| The duty clock's lamp moves with the real time; the dial leans to the pointer | The signature, and it is true | continuous, slow |

Nothing loops for attention, nothing fades in as you scroll, nothing moves because the page
scrolled. Under `prefers-reduced-motion` every one of these rests, and nothing is left hidden.

## Charts

Charts follow the dataviz method: form first, colour by job, validated palette, thin marks,
labels only where they fit, a legend for two or more series, a tooltip on hover and on keyboard
focus, and a table twin for every chart.

- **13th month timeline:** one row per employee, one bar for each stretch at a post (posts
  coloured from the validated categorical slots 1 to 6; past six, one blue and a picker). The
  List tab is its table.
- **Dashboard, posts:** a meter list, one row per post (assigned against required), short posts
  first; the Posts page is its table.
- **Dashboard, people:** one tall segmented bar of the roll by status, with a legend that repeats
  the counts; the Employees page is its table.

Categorical colours (light, on white): `#256abf` `#eb6834` `#1baf7a` `#eda100` `#e87ba4`
`#008300`, validated adjacent-pair safe for colour blindness; three sit under 3:1 on white, so they
always ship with labels or their table. Status red for a stretch or a post that needs fixing is
`#d03b3b`, always with a mark and a word.

## Words

Plain, specific, polite: "Leave for HR approval", "2 of 3 guards", "Create the payout cutoff".
Headings name a thing; buttons say a verb and its object. No em dashes. No invented numbers:
every figure on the dashboard comes from the database, and an empty one says why it is empty and
what fills it.

## Checks

- WCAG AA text contrast on paper and on night; focus visible on every control.
- 44 px touch targets on phones; the menu becomes a drawer; tables and the timeline scroll inside
  their panel, never the page.
- Screens looked at, not only tested: 1440, 1024, 768 and 390 wide.
