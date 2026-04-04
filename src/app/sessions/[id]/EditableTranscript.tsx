'use client'

import { useState } from 'react'

export default function EditableTranscript({
  outputId,
  transcript,
  defaultOpen,
}: {
  outputId: string
  transcript: string
  defaultOpen: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(transcript)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaveError(false)
    try {
      const res = await fetch('/api/update-transcript', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputId, transcript: text }),
      })
      if (!res.ok) throw new Error()
      setEditing(false)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="bg-white rounded-xl border border-gray-200 p-5" open={defaultOpen}>
      <summary className="text-sm font-medium text-gray-600 cursor-pointer">
        Ver transcrição completa
      </summary>

      <div className="mt-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full text-sm text-gray-700 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#502878] resize-y leading-relaxed"
              rows={20}
              autoFocus
            />
            {saveError && (
              <p className="text-xs text-red-600">Erro ao salvar — tente novamente.</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-medium text-white bg-[#502878] hover:bg-[#3d1e5c] px-3 py-1 rounded-lg disabled:opacity-50 transition-colors"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                onClick={() => { setText(transcript); setEditing(false) }}
                disabled={saving}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={(e) => { e.preventDefault(); setEditing(true) }}
              className="absolute top-0 right-0 text-gray-400 hover:text-[#502878] transition-colors"
              title="Editar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed pr-6">{text}</p>
          </div>
        )}
      </div>
    </details>
  )
}
