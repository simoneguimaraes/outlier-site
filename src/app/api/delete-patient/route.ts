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
  const { patientId } = await request.json()
  if (!patientId) return NextResponse.json({ error: 'Missing patientId' }, { status: 400 })

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  // Validate ownership
  const { data: patient } = await supabase
    .from('patients')
    .select('id')
    .eq('id', patientId)
    .eq('user_id', user.id)
    .single()

  if (!patient) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get all audio files to delete from B2
  const { data: outputs } = await supabase
    .from('session_outputs')
    .select('audio_file_path, sessions!inner(patient_id)')
    .eq('sessions.patient_id', patientId)

  if (outputs?.length) {
    await Promise.allSettled(
      outputs
        .filter((o) => o.audio_file_path)
        .map((o) => s3.send(new DeleteObjectCommand({
          Bucket: process.env.B2_BUCKET_NAME?.trim()!,
          Key: o.audio_file_path!,
        })))
    )
  }

  // Delete patient (cascade deletes sessions + session_outputs)
  const { error } = await supabase.from('patients').delete().eq('id', patientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
