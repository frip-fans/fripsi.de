/** Items per music list request; client code imports this without pulling in the server data layer. */
export const MUSIC_BATCH_SIZE = 12;
/** Wide screens show four release columns, so a larger batch keeps rows full. */
export const MUSIC_WIDE_RELEASE_BATCH_SIZE = 16;
export const MUSIC_WIDE_RELEASE_QUERY = "(min-width: 1200px)";
