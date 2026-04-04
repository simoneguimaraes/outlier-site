import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ClinicalNote } from '@/lib/types'
import SessionReview from './SessionReview'
import SessionPoller from './SessionPoller'
import DeleteSession from './DeleteSession'
import EditableCard from './EditableCard'
import ProcessingTimer from './ProcessingTimer'
import EditableTranscript from './EditableTranscript'

function confidenceLabel(confidence: number | null) {
  if (confidence === null) return null
  if (confidence < 0.75) return { label: 'Confiança baixa — revise com atenção', color: 'text-red-600 bg-red-50 border-red-200' }
  if (confidence < 0.90) return { label: 'Confiança média', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' }
  return { label: 'Confiança alta', color: 'text-green-600 bg-green-50 border-green-200' }
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: session } = await supabase
    .from('sessions')
    .select('*, patients(id, name)')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!session) notFound()

  const { data: output } = await supabase
    .from('session_outputs')
    .select('*')
    .eq('session_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const patient = session.patients as { id: string; name: string }
  const confidence = confidenceLabel(output?.transcript_confidence ?? null)

  let clinicalNote: ClinicalNote | null = null
  let summaryMalformed = false
  if (output?.summary_text) {
    try { clinicalNote = JSON.parse(output.summary_text) } catch {
      summaryMalformed = true
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <Link href={`/patients/${patient.id}`} className="text-sm text-gray-700 hover:text-gray-700">
          ← {patient.name}
        </Link>
        <div className="flex items-center gap-4">
          <Link href={`/sessions/${id}/edit`} className="text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-300 px-3 py-2 rounded-lg transition-colors">
            Editar dados
          </Link>
          <DeleteSession sessionId={id} patientId={patient.id} />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Sessão {session.session_number ?? '—'}
          </h2>
          <p className="text-sm text-gray-700 mt-0.5">
            {new Date((session.session_date ?? session.created_at) + (session.session_date ? 'T12:00:00' : '')).toLocaleDateString('pt-BR', {
              day: '2-digit', month: 'long', year: 'numeric'
            })}
          </p>
          {session.notes && (
            <p className="text-sm text-gray-600 mt-2 italic">{session.notes}</p>
          )}
        </div>

        {/* Status banner */}
        {output && <SessionPoller outputId={output.id} status={output.status} />}

        {output && output.status !== 'completed' && (
          <div className={`rounded-xl border p-4 ${
            output.status === 'failed'
              ? 'bg-red-50 border-red-200'
              : 'bg-[#f3eef9] border-[#d4bfea]'
          }`}>
            {output.status === 'failed' ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-red-700">Sua transcrição foi salva com sucesso.</p>
                  <p className="text-sm text-red-600 mt-0.5">Houve um problema ao gerar o resumo — clique em Reprocessar para tentar novamente.</p>
                </div>
                <SessionReview outputId={output.id} mode="retry" />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-[#502878] animate-spin inline-block">⏳</span>
                <div>
                  <p className="text-sm font-medium text-[#3d1e5c]">Processando sessão...</p>
                  <ProcessingTimer createdAt={output.created_at} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Confidence badge */}
        {confidence && output?.status === 'completed' && (
          <div className={`rounded-lg border px-4 py-2 text-sm font-medium flex items-center gap-2 ${confidence.color}`}>
            {confidence.label}
            <span className="group relative cursor-default">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <div className="absolute left-1/2 -translate-x-1/2 bottom-6 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 hidden group-hover:block z-10 font-normal leading-relaxed">
                Confiança da transcrição — baseada na clareza do áudio. Alta (≥90%): confiável. Média (75–90%): revise com atenção. Baixa (&lt;75%): áudio com ruído ou baixa qualidade. Um áudio mais claro melhora o resultado.
              </div>
            </span>
          </div>
        )}

        {/* Malformed summary error */}
        {summaryMalformed && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            Erro ao carregar o prontuário — o conteúdo gerado está em formato inválido. Use o botão "Reprocessar" para tentar novamente.
          </div>
        )}

        {/* Clinical note */}
        {clinicalNote && (
          <div className="space-y-4">
            {[
              ...(clinicalNote!.perfil_biografico ? [{ key: 'perfil_biografico', label: 'Perfil biográfico' }] : []),
              ...(clinicalNote!.trabalho_realizado ? [{ key: 'trabalho_realizado', label: 'Trabalho realizado na sessão' }] : []),
              ...(clinicalNote!.meta_da_sessao ? [{ key: 'meta_da_sessao', label: 'Meta da sessão' }] : []),
              { key: 'demanda', label: 'Demanda' },
              { key: 'humor', label: 'Humor' },
              { key: 'comportamento', label: 'Comportamento' },
              { key: 'pensamento', label: 'Pensamento' },
              { key: 'momentos_significativos', label: 'Momentos significativos' },
              { key: 'tarefas', label: 'Tarefas / Meta da próxima sessão' },
              { key: 'observacoes', label: 'Observações clínicas' },
            ].map(({ key, label }) => (
              <EditableCard
                key={key}
                outputId={output!.id}
                field={key}
                label={label}
                value={clinicalNote![key as keyof ClinicalNote] ?? ''}
              />
            ))}

            <SessionReview outputId={output!.id} mode="copy" summaryText={output!.summary_text ?? ''} />
          </div>
        )}

        {/* Transcript */}
        {output?.transcript_text && (
          <EditableTranscript
            outputId={output.id}
            transcript={output.transcript_text}
            defaultOpen={output.status === 'failed'}
          />
        )}
      </main>
    </div>
  )
}
