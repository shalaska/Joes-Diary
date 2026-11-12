import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI deploys non-interactively, where firebase-tools ignores param defaults: every defineString
// in the gateway needs a line in the project's dotenv file (an empty value is fine).
describe('gateway deploy params', () => {
    it('has a dotenv value for every defineString param', () => {
        const source = readFileSync('gateway/index.js', 'utf8');
        const params = [...source.matchAll(/defineString\('([A-Z0-9_]+)'/g)].map(m => m[1]);
        const env = Object.fromEntries(readFileSync('gateway/.env.joesdiary-d8211', 'utf8')
            .split('\n').map(line => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map(m => [m[1], m[2]]));
        expect(params.length).toBeGreaterThan(0);
        expect(params.filter(name => !(name in env))).toEqual([]);
    });
});
