# GV2 ROADMAP — R2 → Reliability → Phase 7 (Lyrics Alignment + MCP)

> **레포**: `~/Desktop/vc/galaxymap_ytp_v2` (`gv2`)
> **위임 대상**: Claude Code (Mac Studio 로컬 실행)
> **작성**: 2026-06-06 / 시퀀스 마스터 스펙
> **포맷 규약**: vibe-supervisor (기능 추가 시나리오). **단일 진실 공급원은 레포의 `PROJECT_SPEC.md`.**
> 이 문서는 실행 순서·게이트·Phase 7 설계를 담은 *위임 지침서*다. 실행 후 Claude Code는 **반드시 `PROJECT_SPEC.md`를 같은 턴에 갱신**한다(SYNC 의무, §SYNC 참조).

---

## 0. 이 문서가 답하는 것 — 왜 이 순서인가

3블록을 **R2 → 신뢰성 → Phase 7** 순으로 고정한다. 순서가 임의가 아니라 의존성이다.

```
[GATE 1] R2          ─ 풀 1080p ingest = success (50MB 벽 제거)
   │  (정렬은 60초 프리뷰가 아니라 곡 전체 오디오가 있어야 의미가 있다)
   ▼
[GATE 2] 신뢰성        ─ reaper+heartbeat 라이브 · launchd 영구화 · failed UI 피드백
   │  (Phase 7은 상시 워커를 하나 더 띄운다. 침묵실패 표면을 2배로 늘리기 전에 패턴을 굳힌다)
   ▼
[GATE 3] Phase 7      ─ 가사 강제정렬 워커 + MCP. 신뢰성 패턴을 그대로 상속받는다
```

**날카롭게:**
- **R2 먼저** — 정렬 대상은 곡 전체 오디오다. 잘린 60초 프리뷰를 정렬하는 건 무의미. 풀영상 success가 선행조건.
- **신뢰성 그 다음** — Phase 7은 `ingest` 워커에 더해 **두 번째 상시 로컬 워커(align)** 를 띄운다. 헬스체크 없는 상시 워커는 곧 또 하나의 침묵실패원이다. 패턴을 ingest에서 한 번 만들어 증명하면, align 워커는 그걸 공짜로 상속한다.
- **Phase 7 마지막, 그 안에서도 v1 먼저** — 줄단위·WhisperX·에디터보정(v1)이 단어단위·MFA·카라오케(v2)보다 먼저 나간다.

---

## BLOCK 1·2 — R2 + 신뢰성 (별도 문서)

상세 스펙은 **`R2_MIGRATION_SPEC.md`** 에 있다. 여기서 중복하지 않는다(drift 방지). 이 로드맵은 그 두 블록의 **완료 게이트만** 정의한다.

### 이번 세션에 선반영된 것 (DB 라이브 검증 완료, 2026-06-06)
- `projects.processing_started_at` (timestamptz) — 추가됨
- `worker_health` 테이블 + RLS on + `worker_health_read`(SELECT/authenticated) — 추가됨
- pg_cron `reap_stale_ingest` (`*/2 * * * *`, 15분 타임아웃) — 라이브. `processing_started_at` NULL 행은 자동 제외라 워커 B-2 적용 전까지 안전.

### GATE 1 통과 기준 (R2)
- [ ] 50MB 초과 1080p 풀영상 ingest → `import_status=success`, R2에 `{uid}/sources/...` 키로 객체 존재
- [ ] 브라우저 프리뷰가 presigned URL로 재생 + 타 uid key 요청 시 403 (격리 유지)
- [ ] boto3 1.36+ 체크섬 회피 적용(`request_checksum_calculation="when_required"`)

### GATE 2 통과 기준 (신뢰성)
- [ ] 워커 ingest claim 시 `processing_started_at=now()` 기록 (B-2)
- [ ] 워커 루프마다 `worker_health` 하트비트 upsert
- [ ] 처리 중 워커 kill → 최대 17분 내 행이 `failed` 전환 + UI에 에러 노출
- [ ] 워커 재기동 시 부팅 self-heal(자기 stale-processing 정리)
- [ ] `./setup.sh`로 launchd 영구등록 — **GATE 2의 다른 항목 통과 후에만**

> 두 게이트 다 통과해야 Phase 7 진입. 통과 전 진입 금지.

---

## BLOCK 3 — Phase 7: 가사 강제정렬(Forced Alignment) + MCP

### 7.0 용어 못박기
원하는 건 transcription(받아쓰기)이 아니라 **forced alignment(이미 아는 가사에 시간 도장 찍기)** 다. 가사는 이미 보유 → 정렬 문제.

**v1은 보컬 분리(Demucs) 없이 풀믹스에 직접 정렬한다.** 노래는 말이 아니라서(멜리스마·애드립·악기 베드) 풀믹스 정렬 정확도는 분리본보다 낮다 — 그 손실은 에디터 드래그 보정이 흡수한다. **보컬 분리는 필수재가 아니라 정확도 부스터**다. 수동 보정으로 감당 안 되는 곡이 나오면 그때 [1]과 [2] 사이에 Demucs를 선택적 전처리로 끼운다(§7.8-3, Backlog).

### 7.1 Compute Topology (이 환경의 상수 준수)
- **전부 Mac Studio M1 Max 로컬 24h 워커에서 돈다.** ffmpeg·WhisperX 로컬(MPS) → 클라우드 GPU 비용 $0. (Demucs는 v1 비포함, 옵션 추가 시에만 로컬 합류)
- 신규 워커 디렉터리: `workers/align/` (`workers/ingest/`와 병렬). [CONFIRM] 디렉터리명.
- ⚠️ 무거운 미디어 작업을 Vercel/Railway 서버리스에 올리지 말 것(토폴로지 위반 = 버그).

### 7.2 Storage Topology
- **입력**: 곡 전체 오디오 — R2의 source(Block 1 이후). align 워커는 boto3로 **직접 read**(키 보유, presigned 불필요).
- **출력**: `lyrics_segments` (✅ 이미 존재 — 이번 세션 검증. 컬럼: clip_id·text·start_sec·end_sec·order). 줄단위 v1은 이 테이블에 그대로 기록.
- **상태**: `clips.transcribe_status` (✅ 이미 존재 — pending/processing/success/failed). 정렬 job 상태를 여기 쓴다.
- **신규 필요**: `clips.transcribe_started_at timestamptz` — 신뢰성 reaper가 정렬 job도 커버하려면 필수(아래 7.5).

### 7.3 파이프라인 (v1 — Demucs 없음)
```
clip + lyrics_text
  → [1] 오디오 추출        (ffmpeg, 로컬)
  → [2] 강제정렬           (WhisperX align, 로컬) ← 풀믹스에 직접, 보유 가사 기준 타임스탬프
  → [3] 줄단위로 병합 → lyrics_segments 기록 (Zod 검증 write)
  → clips.transcribe_status = success
```
- [3] write 전 **Zod 스키마 검증 의무**(레포 규약 — 검증 안 된 외부/모델 출력 흘리기 금지).
- **옵션(후속)**: 정확도 부족 시 [1]→[2] 사이에 `[1.5] 보컬 분리(Demucs)` 삽입. 워커 인터페이스를 미리 단계 삽입 가능하게 설계하면 나중에 끼우기 쉽다(stem은 로컬 스크래치, job 종료 시 삭제 — R2 업로드 금지).

### 7.4 Job/Flow 태깅 (project_spec `## Jobs & Flows`에 추가)
- `align_lyrics` job — **[runs: Mac Studio 로컬 align 워커] [reads: R2 source] [stores: lyrics_segments / clips.transcribe_status (Supabase)]**

### 7.5 신뢰성 레이어 재사용 (Block 2 패턴 상속)
align 워커도 상시 → 같은 안전망을 붙인다:
- `clips.transcribe_started_at` 추가(claim 시 기록).
- align 워커 하트비트: `worker_health`에 `worker_id='align'`로 upsert.
- **reaper 확장**: 기존 `reap_stale_ingest`와 동형의 pg_cron 잡 추가 — `transcribe_status='processing'` & `transcribe_started_at < now()-interval 'N min'` → `failed`. (N은 정렬 실측 후 확정. 곡 길이 비례라 ingest보다 길게.)
- 죽으면 UI가 `transcribe_status=failed` + 에러 노출 + 재시도.

### 7.6 MCP 레이어 (Claude Code 연결)
기존 Next.js API + 워커 위에 얇은 RPC. **비동기 필수**(정렬은 수초~수분 → 블로킹 금지).

노출 툴(시그니처 초안):
- `ingest_video(url, artist, title)` → `{ project_id }`
- `align_lyrics(clip_id, lyrics_text, mode="line")` → `{ job_id }`  ← async 시작
- `check_alignment(job_id)` → `{ status, segments? }`            ← 폴링
- `render_short(clip_id, preset)` → `{ render_job_id }`
- `check_render(render_job_id)` → `{ status, url? }`

- 패턴: **start → job_id 반환 → check 폴링.** Block 2의 job status/heartbeat/reaper 인프라를 그대로 폴링 백엔드로 씀.
- **MCP 호스트 위치**: Mac Studio 로컬(워커 옆) + Cloudflare Tunnel로 노출. 무거운 작업이 로컬이라 compute home을 하나로 유지. [CONFIRM] 메모리상 로컬 Python 워커를 Cloudflare Tunnel로 노출 중 → 같은 방식 재사용 가정.
- 결과 그림: Claude Code에서 *"이 클립 + 이 가사 → 정렬 → 렌더"* 가 한 에이전트 플로우.

### 7.7 v1 → v2 루프
- **v1**: WhisperX **풀믹스 직접정렬**, **줄단위**, 에디터 드래그 보정. 목표 = "동작하는 파이프라인". 한영 혼용은 ~90% 가정, 사람이 보정. (Demucs 없음)
- **v2**: MFA(한국어 음향모델+발음사전), **단어단위 카라오케**. 단어단위 저장은 신규(`lyrics_words` 테이블 또는 `lyrics_segments.words jsonb`) — v2 진입 시 Data Model 확장.

### 7.8 설계 결정 (A/B/추천)
구현 방향이 갈리는 지점 — 추천은 음악적 확장성·AI 활용·장기 자산화 축 기준.

1. **정렬 엔진(v1)** — A: WhisperX / B: MFA
   - A 장점: 셋업 쉬움·다국어·빠른 반복 / 리스크: 음소단위 정밀도는 MFA보다 낮음
   - B 장점: 음소단위·한국어 모델 정확 / 리스크: 셋업 무겁고 반복 느림
   - **추천: A(WhisperX) for v1.** 먼저 동작하는 루프 확보가 자산. 정밀도는 v2 MFA로.

2. **정렬 단위** — A: 줄단위 / B: 단어단위
   - A 장점: 견고·숏츠에 충분·lyrics_segments 구조와 일치 / 리스크: 카라오케식 단어 하이라이트 불가
   - B 장점: 단어 카라오케 표현 / 리스크: 한영 혼용 보컬에서 불안정·디버깅 비용
   - **추천: A(줄단위) for v1**, 단어단위는 v2.

3. **보컬 분리(Demucs)** — A: v1 비포함(풀믹스 직접정렬) / B: 항상 분리
   - A 장점: 파이프라인 단순·의존성↓·속도↑·stem 저장/연산 없음 / 리스크: 풀믹스 정렬 정확도가 분리본보다 낮음
   - B 장점: 정렬 정확도↑ / 리스크: 무거운 추가 단계·큰 stem 스크래치·셋업 비용
   - **추천: A(v1 제외).** Demucs는 필수재가 아니라 정확도 부스터. **수동 보정으로 감당 안 되는 곡이 실제로 나올 때** 조건부 옵션으로 [1.5]에 삽입(Backlog). 조기 도입 회피.

4. **MCP 호스트** — A: Mac Studio + Tunnel / B: Railway
   - **추천: A.** 무거운 작업이 로컬이라 compute를 한 집에. Railway는 프론트 유지.

### 7.9 Acceptance Criteria (Phase 7 v1 — 전부 통과해야 done)
- [ ] clip + 보유가사 → `lyrics_segments`에 그럴듯한 줄 타임스탬프 채워짐, `transcribe_status=success`
- [ ] 정렬 중 align 워커 kill → reaper가 N분 내 `transcribe_status=failed` 전환 + UI 노출
- [ ] MCP: Claude Code가 `align_lyrics`→`job_id`→`check_alignment` 폴링→success→segments 반환
- [ ] 에디터에 정렬된 줄 표시 + 드래그 nudge 보정 동작(보정 레이어)
- [ ] **한영 코드스위칭 테스트 클립**으로 정확도 실측 → 예상 보정률을 spec에 기록
- [ ] 빌드통과 ≠ 통과. 브라우저 런타임 검증 필수.

### 7.10 리스크 / Known
- 한국어 정렬은 영어보다 약함. **한영 코드스위칭이 최악 케이스 = 정확히 이 채널의 장르.** → 전자동 목표 금지, "90%+빠른 보정" 목표.
- **v1 풀믹스 직접정렬 = 의도된 트레이드오프.** 악기 베드가 정렬을 흔드는 만큼 정확도 손실 → 에디터 보정으로 흡수. 보정으로 감당 안 되는 곡이 누적되면 그게 Demucs 도입 신호.
- 단어단위 불안정 → 줄단위 기본.
- WhisperX 의존성(torch 버전) 지옥 가능 → 버전 핀 고정.
- WhisperX 첫 실행 모델 다운로드·레이턴시 — 워커 부팅 시 워밍업.
- R2 저장량 급증(풀영상) → lifecycle/TTL 정리 정책은 후속 스펙.

---

## SYNC 의무 (작업 종료 직전, 생략 불가)

Phase 7 구현 후 Claude Code는 `PROJECT_SPEC.md`를 다음과 같이 갱신한다:
- `## Data Model` — `clips.transcribe_started_at` 추가, (v2 시) 단어단위 저장 구조
- `## Jobs & Flows` — `align_lyrics` job [runs]/[reads]/[stores] 태깅, MCP 툴 5종
- `## Compute Topology` — align 워커(Mac Studio), MCP 호스트(Mac Studio+Tunnel)
- `## Storage Topology` — R2 source read 경로, lyrics_segments write
- `## Build Status` — Phase 7 v1 등록/완료 표시
- `## Decisions` — 7.8의 4개 결정 한 줄씩
- `## Known Issues / Backlog` — 한영 정렬 정확도, **Demucs 보컬분리(조건부 옵션, 풀믹스 보정 한계 초과 시 [1.5] 삽입)**, v2(MFA/단어단위), R2 lifecycle

drift 자가점검 5항목(Architecture/토폴로지/Conventions/Decisions/Backlog) 하나라도 NO면 미완.

---

## 실행 순서 요약 (한 눈)

```
GATE 1  R2 풀영상 success      →  R2_MIGRATION_SPEC.md §2 (Lane A)
GATE 2  신뢰성 라이브+launchd   →  R2_MIGRATION_SPEC.md §3·§4 (Lane B)  [DB 선반영 완료]
GATE 3  Phase 7
        ├ 7.3 파이프라인 v1 (ffmpeg→WhisperX 풀믹스→줄단위→lyrics_segments) · Demucs 없음
        ├ 7.5 reaper에 정렬 job 편입 (transcribe_started_at + pg_cron)
        ├ 7.6 MCP 5툴 (async start→job_id→poll)
        ├ 7.9 Acceptance 통과
        └ v2 루프: MFA 한국어 + 단어단위 카라오케
SYNC    PROJECT_SPEC.md 갱신 (매 블록 종료 시)
```
