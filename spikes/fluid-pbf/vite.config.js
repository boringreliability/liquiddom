import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5181, strictPort: true },
  build: { target: 'es2022' },
});
