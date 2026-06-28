import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// base: './' -> funktioniert auch in Unterordnern / beim statischen Ausliefern.
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        info: resolve(root, 'info.html'),
      },
    },
  },
})
