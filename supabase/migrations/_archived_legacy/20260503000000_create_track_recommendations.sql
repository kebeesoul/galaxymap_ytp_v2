CREATE TABLE IF NOT EXISTS track_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  rank SMALLINT NOT NULL CHECK (rank BETWEEN 1 AND 3),

  artist TEXT NOT NULL,
  song_title TEXT NOT NULL,
  release_year INT,
  genre TEXT,
  reason TEXT,

  role TEXT NOT NULL CHECK (role IN ('popular', 'reliable', 'wildcard')),
  popularity_estimate SMALLINT CHECK (popularity_estimate BETWEEN 1 AND 10),

  topic TEXT,
  era TEXT,
  genre_filter TEXT,

  yt_video_id TEXT,
  yt_search_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (yt_search_status IN ('pending', 'found', 'not_found')),

  used BOOLEAN DEFAULT FALSE,
  used_project_id UUID REFERENCES projects(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_track_recommendations_batch ON track_recommendations(batch_id);
CREATE INDEX IF NOT EXISTS idx_track_recommendations_unused ON track_recommendations(used) WHERE used = false;
CREATE INDEX IF NOT EXISTS idx_track_recommendations_role ON track_recommendations(role);
