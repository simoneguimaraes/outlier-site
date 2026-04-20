# Outlier IA

Ferramenta para psicólogas clínicas gravarem sessões, transcreverem e gerarem resumos automáticos com IA.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Linguagem**: TypeScript
- **Estilização**: Tailwind CSS
- **Banco de dados**: Supabase (Auth + Postgres)
- **Storage de áudio**: Backblaze B2
- **Transcrição**: Deepgram
- **Resumo**: Google Gemini

## Pré-requisitos

Crie contas gratuitas em:

- [Supabase](https://supabase.com) — banco de dados e autenticação
- [Backblaze B2](https://www.backblaze.com/cloud-storage) — armazenamento de áudios
- [Deepgram](https://deepgram.com) — transcrição de áudio
- [Google AI Studio](https://aistudio.google.com) — geração de resumos

## Setup

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key

GEMINI_API_KEY=sua_gemini_api_key

DEEPGRAM_API_KEY=sua_deepgram_api_key

B2_KEY_ID=seu_b2_key_id
B2_APPLICATION_KEY=sua_b2_application_key
B2_BUCKET_NAME=nome_do_bucket
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com

CRON_SECRET=uma_string_aleatoria_segura
```

**Onde encontrar cada valor:**

- **Supabase**: app.supabase.com → seu projeto → Settings → API
- **Backblaze B2**: backblaze.com → App Keys → Add a New Application Key
- **Deepgram**: console.deepgram.com → API Keys → Create a Key
- **Gemini**: aistudio.google.com → Get API key

### 3. Configurar o banco de dados

No Supabase, abra o SQL Editor e execute:

```
supabase/schema.sql
```

### 4. Configurar Storage (Backblaze B2)

1. Crie um bucket privado no Backblaze B2
2. Configure o CORS para permitir uploads do browser
3. Coloque o nome do bucket em `B2_BUCKET_NAME`

### 5. Executar

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

## Deploy (Vercel)

1. Conecte o repositório na Vercel
2. Adicione todas as variáveis do `.env.local` nas Environment Variables
3. Faça o deploy

## Estrutura

```
app/          # Rotas e páginas (Next.js App Router)
components/   # Componentes React reutilizáveis
lib/          # Clientes Supabase, B2, utilitários
supabase/     # Schema SQL do banco de dados
types/        # Tipos TypeScript
```
