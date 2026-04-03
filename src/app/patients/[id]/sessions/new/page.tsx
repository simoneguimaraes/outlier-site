'use client'

import { useState, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const ACCEPTED_FORMATS = '.mp3,.mp4,.m4a,.wav,.ogg,.webm,.flac'
const MAX_SIZE_MB = 500
const MAX_DURATION_MINUTES = 60

function getContentType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
  }
  return map[ext] ?? file.type ?? 'audio/mpeg'
}

async function getAudioDurationMinutes(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      audio.src = '' // detach before revoking to stop further fetches
      URL.revokeObjectURL(url)
      resolve(duration / 60)
    }
    audio.onerror = () => { audio.src = ''; URL.revokeObjectURL(url); reject() }
    audio.src = url
  })
}

export default function NewSessionPage() {
  const params = useParams()
  const patientId = params.id as string
  const router = useRouter()
  const supabase = createClient()

  const [file, setFile] = useState<File | null>(null)
  const [sessionNumber, setSessionNumber] = useState('')
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadPercent, setUploadPercent] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Arquivo muito grande. Máximo: ${MAX_SIZE_MB}MB`)
      return
    }
    try {
      const minutes = await getAudioDurationMinutes(f)
      if (minutes > MAX_DURATION_MINUTES) {
        setError(`Áudio muito longo (${Math.round(minutes)} min). Máximo: ${MAX_DURATION_MINUTES} minutos.`)
        return
      }
    } catch {
      // Cannot read duration metadata — allow and let the pipeline handle it
    }
    setError('')
    setFile(f)
  }

  async function uploadToB2(presignedUrl: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presignedUrl)
      // B2 CORS allows all headers (allowedHeaders: ["*"]) — safe to set Content-Type.
      // Use getContentType (extension-based) because file.type is unreliable on iOS/macOS.
      // Send File directly (not ArrayBuffer) so the browser streams it — avoids
      // loading the entire file into JS memory, which can silently abort on mobile.
      xhr.setRequestHeader('Content-Type', getContentType(file))

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100)
          setUploadPercent(pct)
          setUploadProgress(`Enviando áudio... ${pct}%`)
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload falhou: ${xhr.status} ${xhr.responseText.slice(0, 200)}`))
        }
      }

      xhr.onerror = () => reject(new Error(`Erro de rede durante o upload (status: ${xhr.status})`))
      xhr.ontimeout = () => reject(new Error('Timeout durante o upload'))

      xhr.send(file)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Selecione um arquivo de áudio.'); return }

    setUploading(true)
    setUploadPercent(0)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // 1. Create session record
    setUploadProgress('Criando sessão...')
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: user.id,
        patient_id: patientId,
        session_number: sessionNumber ? parseInt(sessionNumber) : null,
        session_date: sessionDate || null,
        notes: notes.trim() || null,
      })
      .select()
      .single()

    if (sessionError || !session) {
      setError(sessionError?.message ?? 'Erro ao criar sessão.')
      setUploading(false)
      return
    }

    // 2. Get presigned URL from our API
    setUploadProgress('Preparando upload...')
    const urlRes = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.id,
        fileName: file.name,
      }),
    })

    if (!urlRes.ok) {
      setError('Erro ao preparar o upload.')
      setUploading(false)
      return
    }

    const { url: presignedUrl, key: audioPath } = await urlRes.json()

    // 3. Upload directly to B2
    try {
      await uploadToB2(presignedUrl, file)
    } catch (err) {
      console.error('B2 upload error:', err)
      // Rollback: delete the session created in step 1 to avoid phantom records
      await supabase.from('sessions').delete().eq('id', session.id)
      setError(`Erro ao enviar o áudio: ${err instanceof Error ? err.message : String(err)}`)
      setUploading(false)
      return
    }

    // 4. Create session_output record
    setUploadProgress('Iniciando processamento...')
    const { data: output, error: outputError } = await supabase
      .from('session_outputs')
      .insert({
        session_id: session.id,
        status: 'pending',
        audio_file_path: audioPath,
      })
      .select()
      .single()

    if (outputError || !output) {
      // Rollback: delete session to avoid phantom records (audio already in B2 will be cleaned by daily cron)
      await supabase.from('sessions').delete().eq('id', session.id)
      setError('Erro ao iniciar processamento. Tente novamente.')
      setUploading(false)
      return
    }

    // 5. Trigger async processing (fire-and-forget — SessionPoller tracks status)
    fetch('/api/process-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputId: output.id }),
    })

    router.push(`/sessions/${session.id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <Link href={`/patients/${patientId}`} className="text-sm text-gray-700 hover:text-gray-700">← Voltar</Link>
      </header>

      <main className="max-w-lg mx-auto px-6 py-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Nova sessão</h2>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

          {/* Audio upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Áudio da sessão</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-[#9370b8] transition-colors"
            >
              {file ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-700 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-700">Clique para selecionar o arquivo</p>
                  <p className="text-xs text-gray-600 mt-1">MP3, M4A, WAV, OGG, WEBM · máximo 60 minutos</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Session date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Data da sessão
            </label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#502878]"
            />
          </div>

          {/* Session number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Número da sessão <span className="text-gray-600 font-normal">(opcional)</span>
            </label>
            <input
              type="number"
              value={sessionNumber}
              onChange={(e) => setSessionNumber(e.target.value)}
              min={1}
              placeholder="Ex: 12"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#502878]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Observações <span className="text-gray-600 font-normal">(opcional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Contexto relevante antes do processamento..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#502878] resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-[#502878]">
                <span className="animate-spin">⏳</span>
                {uploadProgress}
              </div>
              {uploadPercent > 0 && uploadPercent < 100 && (
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-[#502878] h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${uploadPercent}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full bg-[#502878] text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-[#3d1e5c] disabled:opacity-50 transition-colors"
          >
            {uploading ? 'Processando...' : 'Enviar e processar'}
          </button>
        </form>
      </main>
    </div>
  )
}
