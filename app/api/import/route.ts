import { NextResponse } from 'next/server'

export async function POST() {
  // TODO: Phase 1 — validate project_id + url, call Python worker, update import_status
  return NextResponse.json({ error: 'not implemented' }, { status: 501 })
}
