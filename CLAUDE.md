# galaxymap_ytp_v2

## Project
Music Shortform Generator — galaxymap internal tool
Single-user creator workflow. No multi-user. No auto-publishing.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (DB + Storage)
- Remotion (video composition)
- Python workers: yt-dlp, ffmpeg, whisperX

## Render Strategy
- DEV: local Mac Studio render queue (render-queue/worker.ts)
- PROD: Remotion Lambda (lib/rendering/lambda.ts — stub until Phase 4)
- Never deploy render worker to Vercel/Edge

## Current Phase
Phase 1

## Do NOT build
- recommendation engine
- social publishing
- multi-user collaboration
- AI headline generation