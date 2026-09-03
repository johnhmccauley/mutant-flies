# assets

Drop-in replacements for the two models the 3D game builds in code.

| file | replaces |
|---|---|
| `fly.glb` | the mutant fly |
| `man.glb` | the man |

Both are **optional**. With the folder empty the game uses its own procedural
geometry and nothing is fetched.

## Using a model from Meshy (or anywhere else)

1. Generate or model the thing. A prompt in the spirit of the 1985 artwork:
   *"a menacing housefly the size of a man, iridescent blue-black chitin,
   large faceted deep-red compound eyes, six jointed legs, translucent veined
   wings, game asset, clean topology"*.
2. Export **glTF binary (`.glb`)** with textures embedded. Keep it under a few
   megabytes — it is downloaded on every page load.
3. Save it here as exactly `fly.glb` or `man.glb`.
4. Reload. The console logs `mutant-fly: using assets/fly.glb` when a model is
   picked up.

## What the game does to your model

- **Scale is ignored.** It is measured and rescaled to a fixed height — 1.7
  world units for the fly, 1.62 for the man, where one floor square is 1 unit.
  Export at any size you like.
- **It is stood on the floor.** The model's lowest point is moved to y=0, so
  it does not matter where the origin sits.
- **Facing matters.** The game rotates the model about Y to point it the way
  it is travelling, and treats **−Z as forward**. Export facing −Z, or rotate
  it before exporting.
- Every mesh is set to cast and receive shadows.
- The fly keeps its hover bob. It loses the built-in wing beat and leg walk,
  since those drive the procedural parts — if you want the wings moving, bake
  the animation into the model or leave the built-in fly alone.

## Why the files are not in the repository

They would be generated art with their own licence terms, and the game is
meant to run with no downloads at all. The procedural models keep it
self-contained; these are for when you want something richer.
