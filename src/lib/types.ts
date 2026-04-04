export type Patient = {
  id: string
  user_id: string
  name: string
  notes: string | null
  whatsapp: string | null
  cpf: string | null
  birth_date: string | null
  created_at: string
}

export type Session = {
  id: string
  user_id: string
  patient_id: string
  session_number: number | null
  notes: string | null
  created_at: string
}

export type ProcessingStatus =
  | 'pending'
  | 'transcribing'
  | 'transcribed'
  | 'summarizing'
  | 'completed'
  | 'failed'

export type SessionOutput = {
  id: string
  session_id: string
  status: ProcessingStatus
  error_message: string | null
  audio_file_path: string | null
  processing_time_ms: number | null
  transcript_confidence: number | null
  stt_model: string | null
  llm_model: string | null
  prompt_version_id: string | null
  transcript_text: string | null
  summary_text: string | null
  created_at: string
}

export type ClinicalNote = {
  perfil_biografico?: string
  demanda: string
  humor: string
  comportamento: string
  pensamento: string
  momentos_significativos: string
  tarefas: string
  observacoes: string
  trabalho_realizado?: string
  // legacy key (v1.3 and earlier)
  meta_da_sessao?: string
}
