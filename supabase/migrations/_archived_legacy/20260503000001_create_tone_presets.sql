CREATE TABLE IF NOT EXISTS tone_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL CHECK (key IN ('hushwav', 'parkbeat', 'archive')),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_text TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO tone_presets (key, label, description, reference_text)
VALUES
  ('hushwav', 'hushwav', '감성 플레이리스트. 짧은 문장, 여백, 1인칭 회상',
   '[TODO: 키비가 작성한 hushwav 디스크립션 1편]'),
  ('parkbeat', 'parkbeat', '한국 힙합 큐레이션. 시대 맥락, 동료 톤',
   '[TODO: parkbeat 디스크립션 1편]'),
  ('archive', 'archive', '아카이브. 사실 중심, 차분, 곡 히스토리',
   '[TODO: archive 디스크립션 1편]')
ON CONFLICT (key) DO NOTHING;
