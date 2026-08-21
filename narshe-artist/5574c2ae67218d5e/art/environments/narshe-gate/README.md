# Battle 1 authored material study

Status: optional local review skin. It does not replace the accepted Battle 1
materials and has not been published.

## Review

- Authored skin, direct battle entry:
  `http://127.0.0.1:8765/diorama.html?scene=battle&terrain=authored`
- Accepted procedural skin, direct battle entry:
  `http://127.0.0.1:8765/diorama.html?scene=battle`
- The ordinary game URL remains unchanged.

Both review URLs run the production Battle 1 geometry, deployment, camera,
units, rules, and controls. The authored URL changes only surface materials.

## Assets

- `snow-field-v1.jpg` — wind-crusted compacted mountain snow.
- `snow-field-v2.png` — review candidate with broad, matte snow variation and
  no directional micro-striations; lossless and exactly seamless to reduce
  grazing-angle shimmer.
- `winter-road-v1.jpg` — broad blue-grey mining-road stones and ore gravel.
- `ravine-rock-v1.jpg` — faceted blue-violet slate and granite.
- `hewn-timber-v1.jpg` — weathered warm frontier planks and supports.

The four v1 sources were generated with the built-in image tool at 1254×1254,
resized to 1024×1024, and saved as optimized JPEG textures. The original
generated PNGs remain outside the repository. `snow-field-v2.png` was
generated at 1254×1254, low-pass normalized against the v1 color key, and
landed as a lossless 1024×1024 PNG with pixel-matched opposite edges.

## Prompt record

The snow prompt requested a seamless orthographic blue-white mountain snow
material with painterly wind crust, shallow scuffs, sparse mineral grit, cold
daylight, low detail frequency, and no grid, props, characters, perspective,
or directional shadows.

The v2 snow prompt retained the same pale blue-grey overcast tone and muted
brightness while restricting the surface to broad, softly blended cloudy
undulations. It explicitly excluded parallel ridges, hatching, scratches,
grooves, ripples, wind lines, granular speckling, repeated marks, directional
shadows, and other high-frequency or directionally biased detail. The source
was normalized to keep the v1 mean color while substantially reducing local
contrast, then constructed as an exactly seamless tile without JPEG encoding.

The road prompt requested seamless broad irregular blue-grey cobbles and
packed ore gravel with restrained snow in the cracks, handcrafted JRPG
rendering, and no rails, grid, props, characters, or perspective.

The rock prompt requested seamless dark blue-violet slate and granite with
broad faceted planes, muted fissures, restrained frost, low-frequency
painterly rendering, and no brickwork, crystals, complete boulders, props, or
perspective.

The timber prompt requested seamless weathered hewn mountain timber and broad
planks in restrained umber, copper-brown, and charcoal, with hand-adzed grain
and subtle frost, without doors, windows, text, objects, or perspective.

## Rendering behavior

`?terrain=authored` loads the four images into the existing material slots and
waits for them at the entry card. The flag deliberately does not alter map
data, building dimensions, visibility behavior, navigation, or balance.
