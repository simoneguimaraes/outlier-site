'use client'

import { useState } from 'react'

type Props =
  | { outputId: string; mode: 'retry' }
  | { outputId: string; mode: 'copy'; summaryText: string }

export default function SessionReview(props: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [retrying, setRetrying] = useState(false)

  if (props.mode === 'copy') {
    const { summaryText } = props
    async function handleCopy() {
      try {
        // Format as plain text for clipboard
        const note = JSON.parse(summaryText)
        const clean = (s: string) => (s ?? '').replace(/\s*⭐+/g, '').trim()
        const sections = [
          ...(note.perfil_biografico ? [`PERFIL BIOGRÁFICO\n${clean(note.perfil_biografico)}`] : []),
          ...(note.trabalho_realizado ? [`TRABALHO REALIZADO NA SESSÃO\n${clean(note.trabalho_realizado)}`] : []),
          ...(note.meta_da_sessao ? [`META DA SESSÃO\n${clean(note.meta_da_sessao)}`] : []),
          `DEMANDA\n${clean(note.demanda)}`,
          `HUMOR\n${clean(note.humor)}`,
          `COMPORTAMENTO\n${clean(note.comportamento)}`,
          `PENSAMENTO\n${clean(note.pensamento)}`,
          `MOMENTOS SIGNIFICATIVOS\n${clean(note.momentos_significativos)}`,
          `TAREFAS / META DA PRÓXIMA SESSÃO\n${clean(note.tarefas)}`,
          `OBSERVAÇÕES\n${clean(note.observacoes)}`,
        ]
        const text = sections.join('\n\n')
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      } catch {
        setCopyError(true)
        setTimeout(() => setCopyError(false), 3000)
      }
    }

    return (
      <button
        onClick={handleCopy}
        className={`w-full border py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
          copyError
            ? 'border-red-300 text-red-600 bg-red-50'
            : 'border-gray-300 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {copyError ? 'Erro ao copiar — selecione o texto manualmente' : copied ? '✓ Copiado!' : 'Copiar prontuário'}
      </button>
    )
  }

  async function handleRetry() {
    setRetrying(true)
    await fetch('/api/process-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputId: props.outputId }),
    })
    window.location.reload()
  }

  return (
    <button
      onClick={handleRetry}
      disabled={retrying}
      className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50 transition-colors"
    >
      {retrying ? 'Reprocessando...' : 'Reprocessar'}
    </button>
  )
}
