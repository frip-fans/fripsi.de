export type ReleaseType = "album" | "single" | "ep" | "compilation" | "video" | "other";
export type SetlistCompleteness = "complete" | "partial" | "unknown";
export type SetlistConfidence = "official" | "reported" | "unverified";
export type SetlistSection = "main" | "encore" | "double_encore" | "opening" | "other";
export type VersionRelationType =
  | "re-recording_of"
  | "rearrangement_of"
  | "remix_of"
  | "cover_of"
  | "live_version_of"
  | "instrumental_of"
  | "edit_of"
  | "other";

export interface CatalogSource {
  id: string;
  subject_type: "song" | "version" | "release" | "setlist";
  subject_id: string;
  url: string;
  label: string | null;
  source_type: string | null;
  verified_at: string | null;
  created_at: string;
  created_by: string;
}

export interface MusicLibraryStats {
  song_count: number;
  version_count: number;
  release_count: number;
  setlist_count: number;
  performance_count: number;
}

export interface SongSummary {
  id: string;
  slug: string;
  title: string;
  original_artist: string;
  first_release_date: string | null;
  notes: string | null;
  version_count: number;
  release_count: number;
  show_count: number;
  performance_count: number;
}

export interface SongBrowseSummary extends SongSummary {
  search_text: string;
}

export interface SongVersionRecord {
  id: string;
  song_id: string;
  slug: string;
  title: string;
  version_label: string | null;
  artist_credit: string;
  release_date: string | null;
  notes: string | null;
}

export interface VersionRelationRecord {
  id: string;
  child_version_id: string;
  child_version_slug: string;
  child_version_title: string;
  parent_version_id: string;
  parent_version_slug: string;
  parent_version_title: string;
  relation_type: VersionRelationType;
  notes: string | null;
}

export interface SongReleaseAppearance {
  release_id: string;
  release_slug: string;
  release_title: string;
  release_type: ReleaseType;
  release_date: string | null;
  edition: string | null;
  disc_number: number;
  track_number: number;
  display_title: string;
  version_id: string;
  version_slug: string;
  version_title: string;
  version_label: string | null;
}

export interface SongPerformance {
  setlist_id: string;
  performance_label: string;
  event_slug: string;
  event_title: string;
  start_date: string;
  venue: string | null;
  region: string | null;
  position: number;
  section: SetlistSection;
  display_title: string;
  performed_version_id: string | null;
  performed_version_slug: string | null;
  performed_version_title: string | null;
  medley_group: string | null;
}

export interface SongDetail extends SongSummary {
  aliases: string[];
  versions: SongVersionRecord[];
  relations: VersionRelationRecord[];
  releases: SongReleaseAppearance[];
  performances: SongPerformance[];
  sources: CatalogSource[];
}

export interface AdminSongVersion extends SongVersionRecord {
  published: boolean;
  created_at: string;
  updated_at: string;
  sources: CatalogSource[];
}

export interface AdminSongSummary extends SongSummary {
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSongDetail extends AdminSongSummary {
  aliases: string[];
  versions: AdminSongVersion[];
  sources: CatalogSource[];
}

export interface ReleaseSummary {
  id: string;
  slug: string;
  title: string;
  release_type: ReleaseType;
  release_date: string | null;
  catalog_number: string | null;
  edition: string | null;
  notes: string | null;
  track_count: number;
  performed_song_count: number;
}

export interface ReleaseTrackRecord {
  id: string;
  disc_number: number;
  track_number: number;
  display_title: string;
  notes: string | null;
  song_id: string;
  song_slug: string;
  song_title: string;
  version_id: string;
  version_slug: string;
  version_title: string;
  version_label: string | null;
  work_show_count: number;
  exact_version_show_count: number;
}

export interface ReleaseDetail extends ReleaseSummary {
  tracks: ReleaseTrackRecord[];
  sources: CatalogSource[];
}

export interface AdminReleaseSummary extends ReleaseSummary {
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminReleaseDetail extends AdminReleaseSummary {
  tracks: ReleaseTrackRecord[];
  sources: CatalogSource[];
}

export interface SetlistSummary {
  id: string;
  event_id: string;
  performance_label: string;
  title: string | null;
  completeness: SetlistCompleteness;
  confidence: SetlistConfidence;
  notes: string | null;
  event_slug: string;
  event_title: string;
  event_category: string;
  event_classification: string | null;
  start_date: string;
  start_time: string | null;
  venue: string | null;
  region: string | null;
  entry_count: number;
}

export interface SetlistBrowseSummary extends SetlistSummary {
  search_text: string;
}

export interface SetlistEntryRecord {
  id: string;
  position: number;
  section: SetlistSection;
  display_title: string;
  medley_group: string | null;
  notes: string | null;
  song_id: string;
  song_slug: string;
  song_title: string;
  performed_version_id: string | null;
  performed_version_slug: string | null;
  performed_version_title: string | null;
  performed_version_label: string | null;
  song_version_count: number;
  release_titles: string | null;
}

export interface SetlistDetail extends SetlistSummary {
  entries: SetlistEntryRecord[];
  sources: CatalogSource[];
}

export interface AdminSetlistSummary extends SetlistSummary {
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminSetlistDetail extends AdminSetlistSummary {
  entries: SetlistEntryRecord[];
  sources: CatalogSource[];
}

export interface MusicSongOption {
  id: string;
  slug: string;
  title: string;
}

export interface MusicVersionOption {
  id: string;
  song_id: string;
  slug: string;
  title: string;
  version_label: string | null;
}

export interface MusicEventOption {
  id: string;
  slug: string;
  title: string;
  start_date: string;
  classification: string | null;
  setlist_count: number;
}

export interface MusicEditorOptions {
  songs: MusicSongOption[];
  versions: MusicVersionOption[];
  events: MusicEventOption[];
}

export interface MusicLibraryOverview {
  stats: MusicLibraryStats;
  top_songs: SongSummary[];
  recent_releases: ReleaseSummary[];
  recent_setlists: SetlistSummary[];
}

export interface MusicSearchOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface ReleaseSearchOptions extends MusicSearchOptions {
  type?: ReleaseType;
}

export interface SetlistSearchOptions extends MusicSearchOptions {
  year?: string;
  classification?: string;
  order?: "asc" | "desc";
}
