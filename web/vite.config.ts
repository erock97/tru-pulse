import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // allow importing the shared flag logic from ../shared
  server: { fs: { allow: ['..'] } },
});
