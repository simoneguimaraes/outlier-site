import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const s3 = new S3Client({
  endpoint: `https://${process.env.B2_ENDPOINT?.trim()}`,
  region: 'us-east-005',
  credentials: {
    accessKeyId: process.env.B2_KEY_ID?.trim() ?? '',
    secretAccessKey: process.env.B2_APPLICATION_KEY?.trim() ?? '',
  },
  forcePathStyle: true,
  // B2 does not support AWS SDK v3 default CRC32 checksums.
  // Without this, the presigned URL includes x-amz-checksum-crc32 which the
  // browser never sends — B2 rejects and returns no CORS headers → xhr status 0.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sessionId, fileName } = await request.json()
  if (!sessionId || !fileName) {
    return NextResponse.json({ error: 'Missing sessionId or fileName' }, { status: 400 })
  }

  // Validate that sessionId belongs to the authenticated user
  const { data: sessionRecord } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .single()

  if (!sessionRecord) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const ext = fileName.split('.').pop()
  const key = `${user.id}/${sessionId}/audio.${ext}`

  const command = new PutObjectCommand({
    Bucket: process.env.B2_BUCKET_NAME?.trim()!,
    Key: key,
  })

  const url = await getSignedUrl(s3, command, { expiresIn: 3600 })

  return NextResponse.json({ url, key })
}
