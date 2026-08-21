// Narshe — the page's boot.
//
// Two lines of work: open a session (the renderer, the frame loop and the
// chrome that outlive any one battle — src/boot/session.mjs), then enter the
// game the URL asked for.
//
// THREE ENTRIES, and which one a URL takes is decided here and nowhere else:
//
//   no parameters          THE CAMPAIGN. Part I end to end — the gate, its
//                          post-battle script and mine finale, then the
//                          warning bell — driven by src/boot/campaign.mjs over
//                          the descriptor in src/content/campaign.mjs. This is
//                          the game.
//   ?battle=… / ?scene=…   ONE battle, or one review scene, exactly as before:
//                          built directly, ending on its own card, with no
//                          campaign around it. Every gate, every tuning link
//                          and every art review takes this path, and it is
//                          unchanged — the campaign is a thing that was added
//                          beside it, not a layer everything now runs through.
//   ?campaign=fresh        the campaign from its start, discarding a saved
//                          position. The only way to see the opening again in
//                          a tab that is partway through the game.
//
// The session/scene split exists so that battles can CHAIN: the integrated
// two-battle game needs the warning bell to follow the gate inside one browser
// session, and a composition root that runs at module scope can only ever
// build one battle per page load. `window.__NARSHE` is the handle a chained
// game — and tools/lifecycle_check.py and tools/campaign_check.py — drive that
// with.

import { createSession } from './boot/session.mjs';
import { createCampaignFlow } from './boot/campaign.mjs';

const session = createSession({ document });
const query = new URLSearchParams(location.search);

// A URL that names a battle or a review scene means THAT battle. A campaign
// wrapped silently around one would make every dev link, gate and art review
// end somewhere other than where it ends today.
const single = query.has('battle') || query.has('scene');

const campaign = single ? null : createCampaignFlow({
  session,
  storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
});

// The debug surface a battle publishes is `window.__BATTLE`, and it is
// replaced wholesale on every transition. This one is the SESSION's, and
// outlives every battle: it is how a caller asks for a different encounter,
// gives the current one back, and reads the renderer's counters at a moment
// when no battle exists to ask. `campaign` is null on a single-battle entry,
// which is also how a caller tells which entry it got. It is read-only on
// purpose: a campaign advances when a battle ENDS, and a handle that could
// skip a step would be a second way to move through the game.
window.__NARSHE = {
  start: (battleId, options) => session.start(battleId, options),
  dispose: expected => session.dispose(expected),
  current: () => session.current(),
  gpu: () => session.gpu(),
  campaign: campaign && {
    id: campaign.id,
    step: () => campaign.step(),
    index: () => campaign.index(),
    steps: () => campaign.steps(),
    finished: () => campaign.finished(),
    checkpoint: () => campaign.checkpoint(),
  },
};

if (campaign) campaign.begin({ fresh: query.get('campaign') === 'fresh' });
else session.start(query.get('battle'));
