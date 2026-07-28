# Mine songbeast concept set

Review-only art generated on 2026-07-27. Nothing in this folder matches the
live loader paths, so these images do not change the playable build.

The script establishes three children total: Lenne plus two unnamed
companions. This first pass therefore contains four identities:

- **Lenne (10):** chestnut bob with one side braid, faded plum patched coat,
  pale blue scarf; quiet, wary resolve.
- **Older child (11):** dark curls, slate cap, navy patched coat, amber scarf;
  reserved and protective. This is the child who leans against the songbeast.
- **Younger child (8):** copper pigtails, ochre coat, teal scarf, cream
  mittens, blue-violet yarn; gentle and absorbed. This is the child who braids
  thread into the songbeast's fur.
- **Songbeast:** large silver-white quadruped with a snow-lion body,
  fawn-like legs, long listening ear-fins, dark pupil-less eyes, and cyan
  resonant bands across the throat and chest.

## Files

`sprites/` contains one front/idle transparent field frame per identity.
`anime/` contains one matching square anime/JRPG illustration per identity.
`contact_sheet.png` compares the two forms. The anime sources remain at their
generated review resolution; resize them to the live 512×512 portrait contract
only after acceptance.

## Generation references

- Field rendering: accepted `art/sprites/miner_front.png` and
  `art/sprites/seira_front.png`.
- Anime rendering: accepted `portraits/seira.png` and `portraits/guard.png`.
- Each anime image uses its own new field sprite as the authoritative identity
  reference.

The common field prompt specified a single full-body subject, neutral tactics
face, slightly elevated three-quarter camera, painted pixel clusters, muted
winter clothing, flat chroma background, no shadow, and child-relative scale.
The common anime prompt preserved the sprite's exact hair, clothing, age, and
recognition cues while adopting the accepted portraits' crop, dark blue-grey
background, restrained painterly rendering, and serious emotional register.

The detailed subject briefs are the four identity descriptions above. Chroma
masters and intermediate files remain under the gitignored
`tmp/imagegen/mine_songbeast/` folder.
