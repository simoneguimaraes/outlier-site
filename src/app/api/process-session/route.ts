import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
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

export const maxDuration = 300 // 5 min — suporta sessões de até ~2h

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const STT_MODEL = 'nova-2'
const LLM_MODEL = 'gemini-2.5-flash'
const MAX_RETRIES = 2

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delayMs = 2000
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries <= 0) throw err
    await sleep(delayMs)
    return withRetry(fn, retries - 1, delayMs * 2)
  }
}

async function transcribeAudio(audioBuffer: ArrayBuffer, mimeType: string): Promise<{
  transcript: string
  confidence: number
}> {
  return withRetry(async () => {
    const response = await fetch('https://api.deepgram.com/v1/listen?language=pt-BR&model=nova-2&diarize=true&punctuate=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`deepgram_error: ${response.status} ${body}`)
    }

    const data = await response.json()
    const channel = data?.results?.channels?.[0]
    const alternative = channel?.alternatives?.[0]

    if (!alternative?.transcript) throw new Error('deepgram_empty_transcript')

    // Average confidence across all words
    const words: Array<{ confidence: number }> = alternative.words ?? []
    const avgConfidence = words.length > 0
      ? words.reduce((sum, w) => sum + (w.confidence ?? 0), 0) / words.length
      : alternative.confidence ?? 0

    return {
      transcript: alternative.transcript,
      confidence: avgConfidence,
    }
  })
}

async function generateClinicalNote(transcript: string, promptText: string): Promise<string> {
  return withRetry(async () => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${LLM_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText + '\n\n---TRANSCRIÇÃO---\n' + transcript }] }],
          generationConfig: { temperature: 0.3 },
        }),
      }
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`llm_generation_error: ${response.status} ${body.slice(0, 200)}`)
    }

    const data = await response.json()
    let content = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) throw new Error('llm_generation_error')

    // Strip markdown code blocks if present (```json ... ```)
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

    // Validate it's parseable JSON
    JSON.parse(content)
    return content
  })
}

export async function POST(request: Request) {
  const { outputId } = await request.json()
  if (!outputId) return NextResponse.json({ error: 'Missing outputId' }, { status: 400 })

  // Validate authenticated user
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const startTime = Date.now()

  // Fetch output record
  const { data: output, error: fetchError } = await supabase
    .from('session_outputs')
    .select('*, sessions(user_id, patient_id, session_number, session_date)')
    .eq('id', outputId)
    .single()

  if (fetchError || !output) {
    return NextResponse.json({ error: 'Output not found' }, { status: 404 })
  }

  // Validate ownership
  const sessionData = output.sessions as { user_id: string; patient_id: string; session_number: number | null; session_date: string | null }
  if (sessionData.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Fetch patient history (last 5 sessions with completed outputs)
  async function getHistoricoPaciente(): Promise<string> {
    const { data } = await supabase
      .from('sessions')
      .select('session_number, session_date, historico_resumido, session_outputs(summary_text, status)')
      .eq('patient_id', sessionData.patient_id)
      .eq('session_outputs.status', 'completed')
      .order('session_date', { ascending: true })
      .limit(5)

    if (!data || data.length === 0) return 'Primeira sessão registrada — sem histórico anterior.'

    return data
      .filter(s => {
        const outputs = s.session_outputs as Array<{ summary_text: string | null; status: string }>
        return outputs?.length > 0
      })
      .map(s => {
        const outputs = s.session_outputs as Array<{ summary_text: string | null }>
        const resumo = s.historico_resumido ?? gerarResumoHistorico(outputs[0]?.summary_text)
        const data_str = s.session_date
          ? new Date(s.session_date + 'T12:00:00').toLocaleDateString('pt-BR')
          : 'data não registrada'
        return `Sessão ${s.session_number ?? '?'} (${data_str}): ${resumo}`
      })
      .join('\n\n') || 'Sem sessões anteriores com prontuário concluído.'
  }

  function gerarResumoHistorico(summaryText: string | null | undefined): string {
    if (!summaryText) return 'prontuário não disponível'
    try {
      const note = JSON.parse(summaryText)
      const campos = ['demanda', 'humor', 'pensamento', 'tarefas']
      return campos
        .filter(k => note[k] && note[k] !== 'Não mencionado na sessão')
        .map(k => `${k}: ${String(note[k]).slice(0, 120)}`)
        .join(' | ')
    } catch {
      return 'prontuário não disponível'
    }
  }

  // Fetch active prompt
  const { data: prompt } = await supabase
    .from('prompt_versions')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!prompt) {
    await supabase.from('session_outputs').update({
      status: 'failed',
      error_message: 'no_active_prompt',
    }).eq('id', outputId)
    return NextResponse.json({ error: 'No active prompt' }, { status: 500 })
  }

  try {
    let transcript: string
    let confidence: number

    if (output.transcript_text) {
      // Reuse existing transcript — skip download and Deepgram call
      transcript = output.transcript_text
      confidence = output.transcript_confidence ?? 0
    } else {
      // Step 1: Download audio from B2
      await supabase.from('session_outputs').update({ status: 'transcribing' }).eq('id', outputId)

      const b2Object = await s3.send(new GetObjectCommand({
        Bucket: process.env.B2_BUCKET_NAME!,
        Key: output.audio_file_path,
      }))

      if (!b2Object.Body) throw new Error('storage_permission_denied')

      const audioBuffer = (await b2Object.Body.transformToByteArray()).buffer as ArrayBuffer
      const ext = output.audio_file_path.split('.').pop() ?? 'mp3'
      const mimeType = ext === 'mp4' ? 'video/mp4'
        : ext === 'wav' ? 'audio/wav'
        : ext === 'm4a' ? 'audio/mp4'
        : ext === 'ogg' ? 'audio/ogg'
        : ext === 'webm' ? 'audio/webm'
        : ext === 'flac' ? 'audio/flac'
        : 'audio/mpeg'

      // Step 2: Transcribe
      const result = await transcribeAudio(audioBuffer, mimeType)
      transcript = result.transcript
      confidence = result.confidence

      await supabase.from('session_outputs').update({
        status: 'transcribed',
        transcript_text: transcript,
        transcript_confidence: confidence,
        stt_model: STT_MODEL,
      }).eq('id', outputId)
    }

    // Step 3: Generate clinical note
    await supabase.from('session_outputs').update({ status: 'summarizing' }).eq('id', outputId)

    const historico = await getHistoricoPaciente()
    const promptWithContext = prompt.prompt_text.replace('CONTEXTO_AQUI', historico)
    const summaryText = await generateClinicalNote(transcript, promptWithContext)

    // Step 4: Save historico_resumido for future sessions
    const resumido = gerarResumoHistorico(summaryText)
    await supabase.from('sessions')
      .update({ historico_resumido: resumido })
      .eq('id', output.session_id)

    // Step 5: Mark completed
    const processingTime = Date.now() - startTime
    await supabase.from('session_outputs').update({
      status: 'completed',
      summary_text: summaryText,
      llm_model: LLM_MODEL,
      prompt_version_id: prompt.id,
      processing_time_ms: processingTime,
    }).eq('id', outputId)

    return NextResponse.json({ ok: true, processingTimeMs: processingTime })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error'
    await supabase.from('session_outputs').update({
      status: 'failed',
      error_message: message,
      processing_time_ms: Date.now() - startTime,
    }).eq('id', outputId)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
