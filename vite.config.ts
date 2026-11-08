import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // VITE_ variables, and the NEXT_PUBLIC_ names some deployments already use
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { target: 'es2022', sourcemap: false },
});
