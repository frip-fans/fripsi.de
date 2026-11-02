export interface VersionVoteSummary {
  id: string;
  song_slug: string;
  song_title: string;
  title: string;
  version_label: string | null;
  artist_credit: string;
  search_text: string;
  vote_count: number;
  average: number | null;
  my_score: number | null;
  phases: number[];
  releases: Array<{ id: string; title: string; type: string; edition: string | null }>;
}

export async function listVersionVotes(db: D1Database, voterId: string): Promise<VersionVoteSummary[]> {
  const result = await db.prepare(`
    SELECT v.id, s.slug AS song_slug, s.title AS song_title, v.title, v.version_label, v.artist_credit,
      TRIM(s.title || ' ' || v.title || ' ' || COALESCE(v.version_label, '') || ' ' || v.artist_credit || ' ' ||
        COALESCE((SELECT GROUP_CONCAT(alias, ' ') FROM song_aliases WHERE song_id = s.id), '')) AS search_text,
      COUNT(vote.voter_id) AS vote_count,
      CASE WHEN COUNT(vote.voter_id) >= 5 THEN ROUND(AVG(vote.score), 1) ELSE NULL END AS average,
      MAX(CASE WHEN vote.voter_id = ? THEN vote.score ELSE NULL END) AS my_score
    FROM song_versions v JOIN songs s ON s.id = v.song_id
    LEFT JOIN song_version_votes vote ON vote.version_id = v.id
    WHERE v.published = 1 AND s.published = 1
    GROUP BY v.id
    ORDER BY v.title COLLATE NOCASE, v.id
  `).bind(voterId).all<VersionVoteSummary>();
  const releases = await db.prepare(`
    SELECT DISTINCT rt.song_version_id AS version_id, r.id, r.title, r.release_type AS type, r.edition
    FROM release_tracks rt JOIN releases r ON r.id = rt.release_id
    JOIN song_versions v ON v.id = rt.song_version_id JOIN songs s ON s.id = v.song_id
    WHERE r.published = 1 AND v.published = 1 AND s.published = 1
    ORDER BY r.title COLLATE NOCASE, r.id
  `).all<{ version_id: string; id: string; title: string; type: string; edition: string | null }>();
  const byVersion = new Map<string, VersionVoteSummary["releases"]>();
  for (const { version_id, ...release } of releases.results) {
    const list = byVersion.get(version_id) ?? [];
    list.push(release);
    byVersion.set(version_id, list);
  }
  const phases = await db.prepare(`SELECT version_id, phase FROM song_version_phases ORDER BY phase`).all<{ version_id: string; phase: number }>();
  const phasesByVersion = new Map<string, number[]>();
  for (const { version_id, phase } of phases.results) {
    const list = phasesByVersion.get(version_id) ?? [];
    list.push(phase); phasesByVersion.set(version_id, list);
  }
  return result.results.map((row) => ({ ...row, releases: byVersion.get(row.id) ?? [], phases: phasesByVersion.get(row.id) ?? [] }));
}

export async function setVersionVote(db: D1Database, versionId: string, voterId: string, score: number | null): Promise<boolean> {
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 10)) throw new Error("Invalid score");
  const version = await db.prepare(`SELECT v.id FROM song_versions v JOIN songs s ON s.id = v.song_id
    WHERE v.id = ? AND v.published = 1 AND s.published = 1`).bind(versionId).first<{ id: string }>();
  if (!version) return false;
  if (score === null) {
    await db.prepare("DELETE FROM song_version_votes WHERE version_id = ? AND voter_id = ?").bind(versionId, voterId).run();
  } else {
    await db.prepare(`INSERT INTO song_version_votes (version_id, voter_id, score, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(version_id, voter_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`)
      .bind(versionId, voterId, score, new Date().toISOString()).run();
  }
  return true;
}
