import { defineConfig } from 'vite';

const serverPort = process.env.SERVER_PORT ?? '3001';

export default defineConfig({
  build: { chunkSizeWarningLimit: 800 }, // three.js is most of it
  server: {
    port: 8080,
    proxy: {
      '/ws': {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
    },
  },
});
