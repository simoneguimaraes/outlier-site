import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

const STUCK_AFTER_MINUTES = 15
const INTERMEDIATE_STATUSES = ['pending', 'transcribing', 'transcribed', 'summarizing']

function authorize(request: Request): boolean {
  const xSecret = request.headers.get('x-cron-secret')
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  return xSecret === process.env.CRON_SECRET || bearer === process.env.CRON_SECRET
}

async function runCleanup() {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString()

  const { data: stuck, error } = await supabase
    .from('session_outputs')
    .select('id, status, created_at')
    .in('status', INTERMEDIATE_STATUSES)
    .lt('created_at', cutoff)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!stuck || stuck.length === 0) {
    return NextResponse.json({ cleaned: 0 })
  }

  const ids = stuck.map((o) => o.id)
  const { error: updateError } = await supabase
    .from('session_outputs')
    .update({
      status: 'failed',
      error_message: 'processing_timeout',
    })
    .in('id', ids)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ cleaned: ids.length, ids })
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCleanup()
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCleanup()
}
