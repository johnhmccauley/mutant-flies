# Mutant Fly

**FLY**, by John McCauley — published in *The Micro User*, July 1985, as the
article *Menace of the mutant flies* with a six-page BBC BASIC listing.

Forty-one years later, playable in a browser two ways: as the 1985 screen, and
in three dimensions.

### ▶ Play: <https://johnhmccauley.github.io/mutant-flies/>

- **[The deep cellars](https://johnhmccauley.github.io/mutant-flies/)** — the game in three dimensions, going down for ever.
- **[The 1985 screen](https://johnhmccauley.github.io/mutant-flies/classic/)** — MODE 1, four colours, the author's own characters, nothing added.

Both run the same rule engine, ported line by line from the original BASIC.

---

## This is a port, not a reconstruction

It began as a recreation from the magazine article and the photographs of the
printed listing. Then the original turned up.

The July 1985 issue is scanned on the Internet Archive; Database Publications'
monthly cassette for that issue survives as a UEF, and two disc conversions of
it survive as SSDs. The program is on all three. `original/FLY.bas` is the
cassette edition, detokenised — 125 lines, numbered 10 to 1240, matching the
printed listing line for line. `src/rules.js` is the port, with the original's
line numbers in its comments.

Reading the actual code corrected a lot of what the article implies:

| what the article suggests | what the code does |
|---|---|
| Controls are "the Z, X and / keys" | Four keys. `INKEY-98` Z, `INKEY-67` X, `INKEY-73` `:`, `INKEY-105` `/` — and the instruction screen says so |
| `PA%` is the "rate at which fly follows man" | `PA%` is a **leash radius**. The fly picks a random direction each turn and may only take the step if it keeps it inside a box `PA%` wide around you. It tightens 400 → 0 across the levels, so it is dragged onto you |
| A time bonus | A **move counter**. `CO%` counts turns and is on screen; the bonus is 300/200/150/100/50/10 by move band, with nothing at all past 800 |
| "any brick, or number of bricks" driven at the fly is powdered | **Exactly one** — the leading brick lands on the fly's square and its redraw wipes it |
| Surround the fly | Four *actual bricks*. `POINT` returns −1 outside the playfield, so the cellar wall is no help and a fly in the corner can never be caught |

It also runs in **MODE 1** — 320×256, four colours — not the MODE 2 the
photographed line 50 appeared to say.

## The rules

You are in a cellar with a fly the size of a man. You cannot kill it. You can
only wall it in.

1. Walking into a brick shoves it one square, and **a whole line of bricks
   shifts together**. A push never fails: you always advance.
2. A brick pushed **off the edge of the cellar is gone for good**.
3. A brick driven **into the fly** is destroyed — one per push, and you stay
   where you are.
4. **Four bricks around the fly** wins the cellar. Walls do not count.
5. **Touching the fly is the end.** One life, and dying wipes your score before
   the high score is ever compared, so a death scores nothing. That is the
   original's behaviour, not a bug in the port.
6. One life. Dying is the end of the run.

The original's own level table, which the 1985 screen still uses exactly
(pick your starting level 1&ndash;9 there):

| Level | Bricks (`PE%`) | Leash (`PA%`) | | Level | Bricks | Leash |
|---|---|---|---|---|---|---|
| 1 | 200 | 400 | | 6 | 75 | 75 |
| 2 | 175 | 300 | | 7 | 50 | 50 |
| 3 | 150 | 200 | | 8 | 40 | 40 |
| 4 | 125 | 150 | | 9 | 30 | 30 |
| 5 | 100 | 100 | | 10+ | 20 | 0 |

At `PA%=0` the fly can only ever step toward you — which is why the original
stops developing at cellar 10 and was never meant to be played past it. The
deep cellars take over the curve from there; see **The descent** below.

## Controls

| Key | |
|---|---|
| `Z` `X` `:` `/` | left, right, up, down — as printed in 1985 |
| `←` `→` `↑` `↓` | also |
| `1`–`9` | starting level, on the 1985 screen |
| `P` `R` `M` | pause, restart the cellar, sound — in the deep cellars |

The 1985 screen adds `S`/`Q` for sound and quiet, the BBC convention. On a
phone, both versions have a touch pad. The deep cellars start at 1 and are
resumed from your last cleared cellar.

## What is faithful

The 3D version is a new presentation of ported rules. The 1985 version tries to
be the thing itself:

- **MODE 1** — 320×256, 40×32 characters, four logical colours, presented at
  4:3 the way a Model B fed a television.
- **The author's own `VDU 23` characters** — the man (`28,28,8,127,8,20,34,65`),
  the fly (two characters overlaid in two colours), and the brick and its
  mortar. Byte for byte from line 150.
- **The palette, and its shifts.** A yellow floor, red bricks with white
  mortar, a black man and fly — and `VDU19` recolours the cellar as you go
  down: magenta at level 3, cyan with blue bricks at 6, magenta again at 8.
- **The title screen**, whose `DATA` statements at line 190 turn out to spell
  **FLY** in bricks.
- **The teletext instruction screen**, verbatim, including the author's
  *"Do not move the bricks to close to the edge"*.
- **`SOUND` and `ENVELOPE`** re-synthesised against the real parameter model —
  pitch at four units to the semitone with 53 as middle C, duration in
  twentieths of a second, and the SN76489's 2 dB-per-step attenuator. The four
  envelopes are the listing's own. The fly's drone is `SOUND0,-10,23,1` fired
  every single turn, on the noise channel at pitch 23 — which slaves its rate
  to tone channel 1, so **the buzz changes timbre after every brick you push**.
  That was free, and the author left it in.

Departures, both deliberate:

- The 3D version takes **150ms a turn** instead of the original's 50. Twenty
  turns a second is a blur in a 3D cellar. Scoring is untouched, because the
  original's pressure was a count of moves rather than a clock.
- The 1985 version's hand-drawn 8×8 font is in the spirit of the BBC's ROM
  font rather than a copy of it.

## Layout

```
index.html            the 3D cellar
classic/index.html    the 1985 screen
src/rules.js          the port of the BASIC - the only copy of the rules
src/font.js           an 8x8 character set
original/FLY.bas      the 1985 listing, detokenised
original/FLY.bbc      the same, still tokenised
assets/               optional .glb models - see assets/README.md
tools/                build, checks and the level plan
```

Both pages are self-contained: `tools/build.js` inlines `src/` into them, so
each HTML file runs from disk, from a server, or on its own.

## Better models

Every monster is built from primitives in code, so the game needs no downloads.
If you would rather use modelled or AI-generated art — Meshy and the like export
`.glb` — drop `fly.glb`, `spider.glb`, `beetle.glb`, `wasp.glb` or `man.glb`
into `assets/` and the game picks them up, rescaling and standing them on the
floor for you. See [assets/README.md](assets/README.md).

The marbles reflect the cellar for real: a cube camera re-renders the scene
from the player's position a few times a second and feeds it to the marble
material as an environment map. It is not path tracing — nothing in WebGL is,
at sixty frames a second — but the reflection is the actual room.

## Working on it

```bash
node tools/build.js          # inline src/ into the pages (run after editing src/)
node tools/check.js          # geometry, syntax, markup, inlined copies in sync
node tools/test-rules.js     # 17 assertions pinning the port to the 1985 listing
node tools/test-monsters.js  # 29 on the monsters, the endless levels, the saves
node tools/test-elements.js  # 45 on slopes, trees, marbles, items, tar and water
node tools/plan.js           # print the descent
```

Ninety-one assertions in all, and every push to `main` runs the lot before
republishing the site. `test-rules.js` is the important one: nothing added
to the deep cellars is allowed to change what happens in the 1985 game.

## The descent

Cellars 1 and 2 are the original, untouched. After that the curve is
hand-made: one new thing at a time, arriving in a deliberately gentle
cellar — usually a single monster and plenty of bricks — so it can be
learned before it is combined with anything else. A screen explains
anything new before the cellar starts.

| | arrives | |
|---|---|---|
| **Spider** | 3 | No wandering. Comes straight at you, every second turn. |
| **Sloping floors** | 4 | Climbing costs a turn; shoving uphill costs another; downhill gives one back. |
| **Beetle**, **boots** | 5 | It eats a brick every fourteen turns. Boots give you two squares a turn. |
| **Wasp**, **frost jars** | 6 | Still for a turn, then two squares at once. Frost stops everything for fifty turns. |
| **Trees and the axe** | 7 | Trees only move for an axe, and an axe is good for three swings. A tree walls a monster in as well as a brick. |
| **Marbles** | 8 | Heavy and they keep going. Uphill they come back at you. Slowly they bounce, quickly they smash bricks, at speed they flatten a monster — or you. |
| **Sealed jars** | 9 | Half are frost. The other half are not. |
| **The tar** | 10 | Break a vat and it runs downhill burning everything, then sets into a wall you did not have to build. |
| **The cistern** | 11 | Water runs further, puts the tar out, shoves marbles along, and sweeps you off your feet. |
| | 12+ | Combinations, tightening. It does not stop. |

Progress is saved in your browser after every cellar cleared, so you can
put it down and pick it up.

## Versions

- **v1** — the game, recreated from the article, playable locally.
- **v2** — published to the web.
- **v3** — the original recovered and properly ported, plus a 3D cellar.
- **v4** — four kinds of monster, endless hand-crafted cellars, saved games,
  and a title screen built out of the game the way the original's was.
- **v5** — sloping floors, trees and the axe, rolling marbles with real
  reflections, and tar and water that flow.

## Credit and copyright

*FLY* and *Menace of the mutant flies* are © The Micro User / Database
Publications, 1985, and are reproduced here by their author. The port, the two
presentations and the tooling are new work.
