/**
 * Plate names for one sprite set.
 *
 * A set is its idle views plus a contiguous walk cycle per view, and the walk
 * cycles may be different lengths (the accepted art gives Seira eight-phase
 * front and back beside a two-frame side). Naming the frame COUNT per view and
 * expanding it here keeps a form's plate list exact: every name a record
 * produces is required, so a missing file is a load error rather than a
 * silently shorter cycle.
 */
export function spriteSetPoses(walkFrames) {
  const views = Object.keys(walkFrames);
  return [
    ...views,
    ...views.flatMap(view => Array.from(
      { length: walkFrames[view] }, (_, i) => `${view}_walk${i + 1}`)),
  ];
}
