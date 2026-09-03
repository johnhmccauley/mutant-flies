# The original

The program this repository is a port of.

| file | what it is |
|---|---|
| `FLY.bas` | the BBC BASIC listing, detokenised to text. 125 lines, numbered 10&ndash;1240. |
| `FLY.bbc` | the same program as raw tokenised BBC BASIC, as it sat on the tape. |

## Where it came from

**FLY**, by John Mc Cauley. `20 REM (C) The Micro User`.

Published in **The Micro User**, volume 3 issue 5 &mdash; July 1985, Database
Publications &mdash; as the article *Menace of the mutant flies* with the
program listing printed later in the same issue. Database sold a monthly
cassette of each issue's programs; the advertisement in that issue reads
*&ldquo;JULY: Fly. Take on mutant flies in this arcade spectacular&rdquo;*, and the
order form lists **Mutant Fly, July 1985**.

This is the **cassette edition**, which matches the printed listing line for
line. Two other variants survive and both differ:

- the **8BS disc conversion** adds a frame limiter (`210 T%=TIME+5` with
  `380 REPEAT UNTIL TIME>T%`, pinning the main loop to 20 turns a second) and
  moves GAME OVER a character to the right;
- the **bbcmicro.co.uk disc** is crunched and Escape-protected (`*FX200,3`,
  `ON ERROR RUN`) and quietly fixes the *&ldquo;to close to the edge&rdquo;* typo on
  the instruction screen.

The cassette edition has no frame limiter at all and runs as fast as BASIC
manages. The port uses the disc edition's 20 turns a second, because that is
the only rate anyone wrote down.

## Reading it

It is BBC BASIC II, so it has named procedures (`DEFPROC`/`ENDPROC`) and
`REPEAT`/`UNTIL` but no `WHILE`, no `CASE` and no multi-line `IF`. The whole
game is played out on the screen itself: there is no map in memory, and every
collision test is a `POINT()` asking the display what colour a square is, with
colour 2 meaning &ldquo;brick&rdquo;. That single trick is why bricks pushed past the
edge of the graphics viewport vanish for good, and why a brick driven into the
fly is destroyed &mdash; the fly's redraw simply paints over it.

Two variables are called `PA%`. One is the array of brick positions dimensioned
at line 90; the other is the fly's leash. BBC BASIC keeps `PA%(1)` and `PA%`
apart, so both are legal, and the listing uses both a few lines from each other.

`src/rules.js` in the parent directory is the line-by-line port, with the
original's line numbers in the comments.

## Copyright

The program is &copy; The Micro User / Database Publications, who ceased
trading long ago; it is reproduced here by its author. The port and everything
else in this repository is new work.
