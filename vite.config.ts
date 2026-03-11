import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
