import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleInsights } from './api/gemini.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), {
      name: 'gemini-dev-api',
      configureServer(server) {
        server.middlewares.use('/api/gemini', (req, res) => {
          void handleInsights(req, res, {
            apiKey: env.GEMINI_API_KEY,
            supabaseUrl: env.VITE_SUPABASE_URL,
            anonKey: env.VITE_SUPABASE_ANON_KEY,
          })
        })
      },
    }],
  }
})
