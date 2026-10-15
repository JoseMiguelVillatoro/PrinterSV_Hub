import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Acepta tanto VITE_SUPABASE_* (manual) como las variables que crea la
// integración Supabase ↔ Vercel (SUPABASE_URL / SUPABASE_ANON_KEY, con o sin
// NEXT_PUBLIC_). Solo se exponen al navegador la URL y la clave pública (anon);
// la service_role key NUNCA se lee aquí.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const pick = (...keys: string[]) => keys.map((k) => env[k]).find((v) => v && v.trim()) ?? '';

  const url = pick('VITE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = pick(
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  );

  return {
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anonKey),
    },
    server: { port: 8080 },
    build: {
      rollupOptions: {
        output: {
          manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'], supabase: ['@supabase/supabase-js'] },
        },
      },
    },
  };
});
