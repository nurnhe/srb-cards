import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Vitest's default exclude list doesn't know about git worktrees other
    // Claude sessions create under .claude/worktrees/ (see CLAUDE.md's own
    // note that this repo's worktree stash is shared) — without this, a
    // concurrent session's checked-out copy gets scanned too, double-running
    // every test and failing on its own not-yet-`npm install`ed backend.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{idea,git,cache,output,temp}/**', '**/.claude/**'],
  },
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
