'use client'

import { useState } from 'react'

export default function EditableCard({
  outputId,
  field,
  label,
  value,
}: {
  outputId: string
  field: string
  label: string
  value: unknown
}) {
  const [editing, setEditing] = useState(false)
  const stripMarkers = (s: string) => s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\s*⭐+/g, '').trim()
  const normalize = (v: unknown): string => {
    if (Array.isArray(v)) return (v as string[]).map((s) => stripMarkers(String(s))).join('\n')
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) return parsed.map((s: string) => stripMarkers(s)).join('\n')
      } catch {}
      return stripMarkers(v)
    }
    return String(v ?? '')
  }
  const [text, setText] = useState(() => normalize(value))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await fetch('/api/update-session-note', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputId, field, value: text }),
    })
    setSaving(false)
    setEditing(false)
  }

  function handleCancel() {
    setText(normalize(value))
    setEditing(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-gray-400 hover:text-[#502878] transition-colors"
            title="Editar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full text-sm text-gray-800 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#502878] resize-y"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium text-white bg-[#502878] hover:bg-[#3d1e5c] px-3 py-1 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (() => {
          const lines = text ? stripMarkers(text).split('\n').filter(Boolean) : []
          if (!lines.length) return <p className="text-sm text-gray-400">—</p>
          if (lines.length === 1) return <p className="text-sm text-gray-800">{lines[0]}</p>
          return (
            <ul className="space-y-2">
              {lines.map((line, i) => (
                <li key={i} className="text-sm text-gray-800 flex gap-2">
                  <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-gray-400" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )
        })()
      }
    </div>
  )
}
