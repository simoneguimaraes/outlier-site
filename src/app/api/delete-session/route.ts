import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'

const s3 = new S3Client({
  endpoint: `https://${process.env.B2_ENDPOINT?.trim()}`,
  region: 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID?.trim() ?? '',
    secretAccessKey: process.env.B2_APPLICATION_KEY?.trim() ?? '',
  },
  forcePathStyle: true,
})

export async function DELETE(request: Request) {
  const { sessionId } = await request.json()
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  // Validate ownership
  const { data: session } = await supabase
    .from('sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get audio path to delete from B2
  const { data: output } = await supabase
    .from('session_outputs')
    .select('audio_file_path')
    .eq('session_id', sessionId)
    .single()

  if (output?.audio_file_path) {
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.B2_BUCKET_NAME?.trim()!,
      Key: output.audio_file_path,
    })).catch(() => { /* ignore B2 errors — proceed with DB deletion */ })
  }

  // Delete session (cascade deletes session_outputs)
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
