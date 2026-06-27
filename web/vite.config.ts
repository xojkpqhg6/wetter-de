import { defineConfig } from 'vite'

// base: './' -> funktioniert auch in Unterordnern / beim statischen Ausliefern.
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
})
