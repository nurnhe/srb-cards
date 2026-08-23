import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 so the port mapping works when this runs inside Docker.
    host: true,
    port: 5173,
    strictPort: true,
    // The app fetches /api/... with a relative URL; this forwards those to the
    // Express backend running alongside it, which also means no CORS setup.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACKEND_PORT || 3000}`,
      },
    },
    watch: {
      // Bind-mounted files do not deliver inotify events on Docker Desktop
      // (macOS/Windows). Set VITE_USE_POLLING=1 there to get hot reload back;
      // on Linux it works without it.
      usePolling: Boolean(process.env.VITE_USE_POLLING),
    },
  },
});
