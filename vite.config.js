import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Rules tests need the Firestore emulator; they run via `npm run test:rules`.
    exclude: [...configDefaults.exclude, 'tests/rules/**'],
  },
})
