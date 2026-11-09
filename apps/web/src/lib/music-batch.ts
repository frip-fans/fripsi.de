/** Items per music list request; client code imports this without pulling in the server data layer. */
export const MUSIC_BATCH_SIZE = 12;
/** Wide screens show four release columns, so a larger batch keeps rows full. */
export const MUSIC_WIDE_RELEASE_BATCH_SIZE = 16;
export const MUSIC_WIDE_RELEASE_QUERY = "(min-width: 1200px)";
/** Song ranking rows are short, so one batch needs more of them to fill a screen. */
export const MUSIC_SONG_BATCH_SIZE = 30;

/** Batch size the server uses for a list kind; the client compares it to decide whether to refetch. */
export function musicBatchSize(kind: string | undefined, wideReleases = false) {
  if (kind === "songs") return MUSIC_SONG_BATCH_SIZE;
  return kind === "releases" && wideReleases ? MUSIC_WIDE_RELEASE_BATCH_SIZE : MUSIC_BATCH_SIZE;
}
