import { defineConfig } from 'vitest/config';

// Firestore security rules tests. They need the emulator, so they run separately:
// npm run test:rules
export default defineConfig({
    test: {
        include: ['tests/rules/**/*.test.js'],
        environment: 'node',
        testTimeout: 20000,
        fileParallelism: false,
    },
});
