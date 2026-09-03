# Menace of the Mutant Flies

A playable recreation of a BBC Micro type-in game, written for
**The Micro User**, July 1985, by **John McCauley** — article on pages 66–69,
program listing from page 168.

> *The locals have told you about a vast fortune that lies hidden in the
> multi-level basement of some nearby ruins… It's no fluke that the fortune
> still remains undisturbed. For it is protected by some fearsome guards —
> mutant flies, the size of a man.*

Runs in any browser. One file, no dependencies, no build step.

**Play it:** open `index.html`.

---

## The machine it came from

| | |
|---|---|
| Computer | Acorn BBC Microcomputer, Model B (1981) |
| CPU | 6502 at 2 MHz |
| RAM | 32K — of which MODE 2 took 20K for the screen alone |
| Language | BBC BASIC II |
| Screen | MODE 2: 160×256 pixels, 20×32 characters, 16 logical colours |
| Sound | Texas Instruments SN76489 — three square-wave tone channels and one noise channel |

BBC BASIC was unusual for its day: it had **named procedures** (`DEFPROC` /
`ENDPROC`), `REPEAT…UNTIL`, and integer variables marked with `%` that ran
markedly faster than floats. That is why a 1985 magazine listing could print a
tidy table of procedure and variable names — and why this port can be read
against it.

## How to play

| Key | |
|---|---|
| `Z` | left |
| `X` | right |
| `:` | up |
| `/` | down |
| `1`–`9` | select starting difficulty |
| `SPACE` | start / continue |
| `I` | instructions |
| `S` / `Q` | sound on / quiet |
| `P` | pause |
| `ESC` | back to the title screen |

Arrow keys work too, and the red function-key strip under the screen is
clickable — it doubles as a live key indicator on desktop and as the d-pad on
a phone.

## The rules

You are in a cellar with a fly the size of a man. You cannot kill it. You can
only wall it in.

1. The cellar is littered with house bricks. Walking into one **pushes** it,
   and a whole line of bricks shoves along together.
2. A brick pushed **off the edge of the cellar is gone for good**. Waste them
   and you may not have enough left to build your barrier.
3. Bricks pushed **directly at the fly are crunched to powder** in its jaws.
   You cannot crush it — pushing a line into it destroys the whole line and
   you don't advance.
4. You win the cellar by **surrounding the fly** so it has no square to move
   to. Walls count, so herding it into a corner is cheapest.
5. Trap it before the clock runs out for a **bonus in proportion to the time
   in reserve**. When the clock hits zero the fly becomes enraged and moves
   at nearly double speed.
6. **The fly touching you is the end.** You get one life. That is all the
   dying you get.
7. Nine difficulty levels are selectable at the start. Each cellar you descend
   into has **fewer bricks** and a **fly more likely to come straight for
   you** — but is worth more points.

The difficulty curve, level 1 → 9:

| Level | Bricks | Chance the fly chases | Fly step | Time |
|---|---|---|---|---|
| 1 | 78 | 28% | 418 ms | 100 s |
| 5 | 54 | 60% | 290 ms | 80 s |
| 9 | 30 | 92% | 162 ms | 60 s |

## What is faithful, and what is reconstruction

The magazine photographs give the complete article text, the procedure table,
the variable table, and the first few lines of BASIC — but the listing itself
is six pages of dense 6-point type that does not survive photography. **This is
a recreation from the published description, not a line-by-line port.**

Faithful:

- The **procedure names** from the magazine's PROCEDURES box are the function
  names here: `PROCinstructions`, `PROCtitle_page`, `PROCmove_bricks`,
  `PROCmove_fly`, `PROCnext_sheet`, `PROCbonus`, `PROCloss`, `PROCset_level`.
- The **variables** from the VARIABLES box are carried in `V`: `HI%` `SC%`
  `X1%,Y1%` `OX%,OY%` `J%` `P%` `I%` `PB%` (bricks displayed) and `PA%`
  (*"rate at which fly follows man"* — which is exactly how the fly's rising
  intelligence is implemented: a percentage chance per step of moving toward
  you rather than at random).
- **Z X : /** — the original's controls, read on the real machine with
  negative `INKEY`.
- The **MODE 2 palette**: eight solid colours built from full-on/full-off RGB,
  plus the eight flashing pairs, flashing at the BBC's default rate.
- An **8×8 bitmap font** and **16×16 sprites** built the way `VDU 23`
  user-defined characters were, from four 8×8 characters glued together.
- The **screen shape**: 320×256 logical pixels presented at 4:3, the way a
  Model B fed a domestic colour television.
- **`SOUND` and `ENVELOPE`** are re-synthesised rather than emulated, but
  against the real parameter model — `SOUND C,A,P,D` with pitch at four units
  to the semitone and duration in twentieths of a second, and the 14-parameter
  `ENVELOPE`. The one envelope legible in the photograph is line 40:
  `ENVELOPE1,1,-10,10,-10,33,33,33,…` — a pitch swinging down ten, up ten and
  down ten again over three sections of 33 hundredth-of-a-second steps. That
  is about a second of warble. That is the fly, and it is used as the fly.

Reconstruction, where the article stops short:

- The exact grid size, brick counts, timings and scoring. The article gives the
  shape of the curve (*"less bricks available… each fly becomes more
  intelligent"*) but not the numbers.
- What happens when the clock expires. The article promises a bonus for time in
  reserve but never says what running out costs, so here it enrages the fly
  rather than killing you outright.
- The artwork. The magazine's illustrations are Micro User house art, not
  screenshots, so the sprites are drawn to the description.

## Files

```
index.html   the whole game — markup, styles, and script in one file
tools/       makes the embeddable (headless) copy used for web publishing
```

## Versions

- **v1** — the game, playable locally.
- **v2** — published to the web so it can be played from anywhere.

## Licence

The 1985 program and article are © The Micro User / Database Publications.
This is a new implementation written from the published description; the code
here is the author's own.
