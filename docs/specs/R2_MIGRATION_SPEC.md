# R2_MIGRATION_SPEC.md

> **위임 대상**: Claude Code (Mac 로컬 실행)
> **레포**: `~/Desktop/vc/galaxymap_ytp_v2` (`gv2`) · **위치**: `docs/specs/R2_MIGRATION_SPEC.md`
> **짝 문서**: `docs/specs/GV2_ROADMAP_R2_RELIABILITY_PHASE7.md` (게이트 순서 = 이 문서 = Block 1·2)
> **작성**: 2026-06-06 / galaxymap_ytp_v2 Phase 3 · **DB완료 반영 패치: 2026-06-06**
> **단일 진실 공급원**: 이 작업의 결과는 `project_spec.md`에 반영할 것 (spec drift 방지)

---

## ⚡ 패치 노트 (먼저 읽을 것)

이 문서의 **§3 신뢰성 레이어 중 DB 부분(B-1 스키마 · B-3 pg_cron reaper)은 이미 적용·라이브 검증 완료**다(2026-06-06, Supabase MCP). Claude Code는 **DB를 새로 만들지 말 것** — 아래 §3은 "할 일"이 아니라 "✅ 완료 / 검증만". 남은 Lane B 작업은 **워커 코드(B-2)와 UI(B-4)뿐**이다.

| Lane B 항목 | 상태 |
|---|---|
| B-1 스키마 (`processing_started_at` · `worker_health` · RLS) | ✅ 적용 완료 |
| B-3 pg_cron `reap_stale_ingest` | ✅ 적용 완료 (라이브) |
| **B-2 워커 코드** (claim 시각 기록 · 하트비트 · 부팅 self-heal) | ⬜ Claude Code 구현 |
| **B-4 UI 피드백** (failed 배지 · 워커 오프라인 배너) | ⬜ Claude Code 구현 |

---

## 0. 컨텍스트 / 왜 이 작업인가

- 현재 ingest 워커(`workers/ingest/`, Python 3.11/pyenv)는 영상을 **Supabase Storage**에 업로드한다.
- Supabase Free Storage는 단일 파일 **50MB 상한** → 1080p 풀영상은 `Payload too large`로 fail. 60초 테스트만 success인 이유.
- **목표**: 업로드 타깃을 Supabase Storage → **Cloudflare R2**로 전환해 50MB 벽 제거 (R2는 egress 무료 + 대용량 OK).
- **동시 목표(필수 동반)**: "워커 죽으면 UI 무한 pending(피드백 0)" 갭을 닫는 **신뢰성 레이어**. R2만 켜고 launchd로 영구화하면 *침묵 실패 공장*이 된다. 두 레인을 **한 패스로 묶는다.**

**라이브 검증 완료(2026-06-06)**: 8테이블·RLS 8정책·시드 무결성 drift 0. tone_presets ref 글자수 892/830/700 일치. UID 격리 저장 동작 확인(`yt_source_path` = `{uid}/sources/...`). 신뢰성 DB 레이어(§3 B-1·B-3) 적용·검증 완료.

---

## 1. 선행 — 사용자(Kebee)가 직접, human-gated 🔒

> 이 단계는 Claude Code가 못 한다. **Kebee가 먼저 완료**해야 Lane A가 시작된다. 이 단계가 도는 동안 Lane B(신뢰성 워커 코드)는 병렬로 진행 가능.

1. Cloudflare 대시보드 → R2 → 버킷 생성: `gv2-sources` (예시명)
2. R2 → Manage API Tokens → **Object Read & Write** 토큰 발급 → 4개 값 확보
3. `.env.local` + Railway 환경변수에 주입:
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=gv2-sources
   R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
   ```
4. (선택) CORS — 브라우저 프리뷰가 presigned URL로 직접 fetch 시 필요. Lane A-3 결정에 따름.

**확인 불가 항목**: 버킷명·토큰 권한 범위는 Kebee 환경 실값. 위 예시명은 그대로 쓰지 말고 실제 값으로.

---

## 2. Lane A — R2 업로드 전환 (worker + app read-side)

### A-1. 워커 업로드 함수 스왑 (boto3, S3 호환)

R2는 S3 API 호환. 워커는 URL이 아니라 **boto3로 직접 put/get** 한다(로컬 Mac에서 키 보유).

```python
# workers/ingest/storage.py (참조 스켈레톤 — 최종 코드는 기존 구조에 맞춰 재작성)
import os, boto3
from botocore.config import Config

def r2_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",                      # R2는 반드시 "auto"
        config=Config(
            request_checksum_calculation="when_required",   # ⚠️ A-4 참조
            response_checksum_validation="when_required",
        ),
    )

def upload_source(local_path: str, key: str) -> str:
    # key 예: f"{owner_uid}/sources/preview/{video_id}.mp4"  ← UID 격리 유지
    r2_client().upload_file(local_path, os.environ["R2_BUCKET"], key)
    return key   # ← DB에는 상대 key만 저장. 절대 URL 저장 금지(A-3)
```

- 기존 Supabase Storage 업로드 호출부를 위 `upload_source`로 교체.
- **`yt_source_path` 저장값은 지금처럼 상대경로(`{uid}/sources/...`) 유지** — UID 격리 속성 보존. 절대 URL을 박지 말 것(환경 바뀌면 깨짐).

### A-2. 워커 read (렌더/처리) — boto3 직접

렌더 워커가 소스를 읽을 때도 URL 불필요. `download_file(bucket, key, local)` 또는 stream. 키 보유 로컬이므로 그대로 S3 API.

### A-3. 브라우저 프리뷰 read — **presigned GET (권장)** vs 공개버킷

| 방식 | 동작 | UID 격리 | 판정 |
|---|---|---|---|
| **presigned URL (권장)** | Next.js 서버 API route가 R2 키로 short-TTL(예 1h) 서명 GET URL 생성 → 클라에 전달. 키는 서버에만. | **유지** (서명 없으면 접근 불가) | ✅ 격리 설계와 정합 |
| 공개버킷 + 커스텀도메인 | 누구나 URL로 접근 | **깨짐** | ⚠️ 격리 포기 시에만 |

→ **presigned 채택.** 격리(`uid_isolated=true`)는 이미 검증된 설계 자산이라 깨지 않는다.

```ts
// app/api/source-url/route.ts (참조 스켈레톤)
import { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
// 1) 세션 owner_uid 확인 → 2) key가 그 uid prefix인지 검증(격리 재확인)
// 3) getSignedUrl(r2, new GetObjectCommand({Bucket, Key}), { expiresIn: 3600 })
```

- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 설치(pnpm).
- 서버 route에서 **세션 uid ≠ key prefix면 403** — RLS와 동일한 격리를 URL 레이어에서도 한 번 더.
- Zod 검증 의무·`as any` 0건 원칙 유지(레포 규약).

### A-4. ⚠️ 알려진 함정 — boto3 1.36+ 체크섬

boto3 1.36부터 기본 데이터 무결성 체크섬(CRC32)이 켜지면서 **R2가 거부 → 업로드/다운로드 에러** 사례 다수. 위 스켈레톤의 `request_checksum_calculation="when_required"` (+ `response_checksum_validation`)로 회피. 또는 env `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`. **이거 안 넣으면 R2 연결 자체가 안 되는 구간에서 시간 날린다.**

### A-5. 기존 데이터

- 현재 Supabase Storage엔 60초 테스트 1건(`작두 - 작두두`)뿐. **마이그레이션 불필요** — R2 컷오버 후 재-ingest로 충분. 테스트 행은 무시/삭제.

### A-6. 스크래치 vs 정본 (업로드 범위)

- **R2 = 정본 입력(source) + 최종 출력(render)만.** 처리 중간재(추출 wav 등)는 **로컬 스크래치, job 종료 시 삭제** — R2 업로드 금지.
- source mp4는 **v1 pass-through**: R2 업로드 후 로컬 삭제(디스크 청결). 같은 곡 반복 처리 패턴이 보이면 그때 로컬 LRU 캐시 도입(조기 최적화 회피).

---

## 3. Lane B — 신뢰성 레이어 (헬스체크 + 타임아웃) 🛡️

> launchd 영구화의 **전제조건**. DB 부분은 ✅ 완료. 워커 코드(B-2)·UI(B-4)만 남음.

### B-1. 스키마 — ✅ 적용 완료 (재실행 금지, 검증만)

아래 DDL이 이미 라이브에 적용돼 있다(Supabase MCP, 2026-06-06). **다시 만들지 말 것.**

```sql
-- [적용됨] processing 진입 시각
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- [적용됨] 워커 생존 하트비트
CREATE TABLE IF NOT EXISTS public.worker_health (
  worker_id    text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  note         text
);
ALTER TABLE public.worker_health ENABLE ROW LEVEL SECURITY;

-- [적용됨] 읽기: authenticated. 쓰기: service_role이 RLS 우회(워커가 service key 사용)
DROP POLICY IF EXISTS worker_health_read ON public.worker_health;
CREATE POLICY worker_health_read ON public.worker_health
  FOR SELECT TO authenticated USING (true);
```

**검증 쿼리(읽기 전용, 안심용)**:
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='projects'
       AND column_name='processing_started_at') AS has_started_col,   -- 기대: 1
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='worker_health' AND c.relrowsecurity) AS wh_rls, -- 기대: 1
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='public' AND tablename='worker_health') AS wh_policy;  -- 기대: 1
```

### B-2. 워커 측 — ⬜ Claude Code 구현 (Lane B 핵심)

- 처리 claim 시: `import_status='processing'`와 동시에 `processing_started_at=now()` set.
- 루프 매 회전마다: `worker_health` upsert(`worker_id='ingest'`, `last_beat_at=now()`). (service_role 키로 write → RLS 우회)
- **부팅 self-heal**: 워커 기동 시 자기 stale-processing 먼저 reap(크래시-재시작 대응) — B-3 reaper와 동일 조건을 부팅 1회 실행.

### B-3. 서버사이드 reaper (pg_cron) — ✅ 적용 완료 (라이브, 검증만)

아래 잡이 이미 등록·가동 중이다. **다시 등록하지 말 것.** (idempotent 재등록이 필요하면 `cron.unschedule('reap_stale_ingest')` 후 재실행)

```sql
-- [적용됨] pg_cron 확장 + 2분마다 15분 타임아웃 reaper
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'reap_stale_ingest', '*/2 * * * *',
  $reaper$
    UPDATE public.projects
       SET import_status = 'failed',
           import_error  = 'timeout: worker did not finish within 15min'
     WHERE import_status = 'processing'
       AND processing_started_at < now() - interval '15 minutes'
  $reaper$
);
```

- **이게 핵심**: 워커가 완전히 죽어도 pg_cron은 서버사이드라 stale job을 failed로 뒤집는다 → UI에 즉시 피드백.
- `processing_started_at`이 NULL인 행은 비교에서 자동 제외 → **B-2 적용 전까지 아무것도 안 건드림(안전).** B-2가 들어가야 reaper가 실제로 동작.
- 타임아웃 15분은 1080p 처리시간 측정 후 조정(첫 풀영상 success 후 실측해 확정).

**검증 쿼리**:
```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname='reap_stale_ingest';  -- 기대: 1행, */2 * * * *, active=t
```

### B-4. UI 피드백 — ⬜ Claude Code 구현

- `import_status='failed'` + `import_error` 메시지를 프로젝트 카드/리스트에 노출(빨강 배지 + 에러 텍스트 + 재시도 버튼).
- (선택) `worker_health.last_beat_at`이 N분 이상 stale이면 상단에 "워커 오프라인" 글로벌 배너.

---

## 4. launchd 영구등록 — **Lane B 완료 후에만**

```bash
cd workers/ingest && ./setup.sh   # launchd 영구 등록
```

- 순서 엄수: 신뢰성 레이어(B-2·B-4)까지 머지·검증 → 그 다음 영구화. 거꾸로 하면 침묵 실패를 영구화하는 것.

---

## 5. 검증 / Acceptance Criteria (전부 통과해야 done)

> DB(스키마·cron)는 §3 검증 쿼리로 이미 통과. 아래는 **코드 머지 후 런타임** 기준.

1. **50MB 벽 제거**: 1080p 풀영상(>50MB) ingest → `import_status=success`, R2 버킷에 `{uid}/sources/...` 키로 객체 존재. (Lane A)
2. **격리 유지**: 브라우저 프리뷰가 presigned URL로 재생됨 + 다른 uid의 key 요청 시 403. (Lane A)
3. **타임아웃 동작**: 처리 중 워커 강제 kill → 최대 15분(+cron 2분) 내 해당 행 `failed`로 전환 + UI에 에러 노출. (B-2+B-3+B-4)
4. **self-heal**: 워커 재기동 → stale-processing이 부팅 reaper로 정리됨. (B-2)
5. **하트비트**: `worker_health.last_beat_at`이 워커 가동 중 갱신됨. (B-2)
6. 빌드 통과 ≠ 통과. **브라우저 런타임 검증 필수** (오늘 교훈).
7. `git diff --name-status`로 변경 표면 확인 + `project_spec.md` 갱신.

---

## 6. 리스크 / 결정 필요 사항

- **R2 presigned TTL**: 1h 기본. 에디터 장시간 세션 시 만료 → 클라에서 401/403 받으면 재발급 로직 필요(refetch). 첫 버전은 단순 1h, UX 이슈 나오면 추가.
- **CORS**: presigned URL을 브라우저가 직접 fetch하면 R2 버킷 CORS 설정 필요(허용 오리진 = 앱 도메인 + localhost).
- **render_path도 동일 전환 대상인가**: 이번 스펙은 *source(ingest)* 만 다룬다. clips.render_path(렌더 결과물)도 같은 R2 패턴 필요하면 별도 패스로 — 단 코드는 A-1 함수 재사용.
- **비용**: R2 스토리지 과금(저장량) 발생, egress는 무료. 50MB→풀영상이면 저장량 급증 — 오래된 source 정리(TTL/lifecycle rule) 정책을 다음 스펙에서.
- **LLM Gemini 전환(#81)과 독립**: 이 작업과 충돌 없음. 별도 트랙.

---

## 7. 실행 순서 요약 (한 눈)

```
[Kebee]  §1 R2 버킷·키 발급·env 주입 ───────────┐ (human-gated, 지금 트리거)
                                                 │
[DB]     §3 B-1 스키마 · B-3 pg_cron reaper  ✅ 적용·검증 완료 (이번 세션)
                                                 │
[Claude Code · 병렬 가능]                         │
  Lane B (신뢰성 코드)  §3 B-2 워커(하트비트+claim기록+self-heal) · B-4 UI  ← 키 없이 즉시 시작
  Lane A (R2전환)       §2 boto3 스왑→presigned→checksum회피            ← §1 완료 후 시작
                                                 │
  §4 launchd 영구등록  ← Lane B(B-2·B-4) 머지·검증 후에만   ┘
  §5 Acceptance 7항목 전부 통과 → §6 결정사항 spec 반영
```
