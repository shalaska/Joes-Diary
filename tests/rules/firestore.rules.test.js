// Runs against the Firestore emulator: npm run test:rules
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';

const JOE = 'joe-uid';
const STRANGER = 'stranger-uid';

let env;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-joes-diary',
        firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
});

afterAll(async () => {
    await env?.cleanup();
});

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'allowedUsers', JOE), { addedBy: 'test' });
        await setDoc(doc(db, 'users', JOE, 'entries', '2026-11-09'), { content: 'private' });
        await setDoc(doc(db, 'users', JOE, 'settings', 'general'), { theme: 'light' });
    });
});

const asJoe = () => env.authenticatedContext(JOE).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnonymous = () => env.unauthenticatedContext().firestore();

describe('owner access', () => {
    it('lets the allowed owner read, write and delete their own data', async () => {
        const db = asJoe();
        await assertSucceeds(getDoc(doc(db, 'users', JOE, 'entries', '2026-11-09')));
        await assertSucceeds(getDocs(collection(db, 'users', JOE, 'entries')));
        await assertSucceeds(setDoc(doc(db, 'users', JOE, 'todos', 't1'), { text: 'x' }));
        await assertSucceeds(setDoc(doc(db, 'users', JOE, 'dayMetadata', 'd1'), { sortIndex: 1 }));
        await assertSucceeds(deleteDoc(doc(db, 'users', JOE, 'trash', '2026-11-09')));
        await assertSucceeds(getDocs(collection(db, 'users', JOE, 'todoTrash')));
        await assertSucceeds(deleteDoc(doc(db, 'users', JOE, 'todoTrash', 't1')));
    });

    it('lets the owner read and answer the agent\'s suggestions', async () => {
        const db = asJoe();
        await assertSucceeds(getDocs(collection(db, 'users', JOE, 'agentProposals')));
        await assertSucceeds(setDoc(doc(db, 'users', JOE, 'agentProposals', 'p1'), { status: 'dismissed' }, { merge: true }));
    });
});

describe('other users', () => {
    it('cannot read another user\'s entries', async () => {
        await assertFails(getDoc(doc(asStranger(), 'users', JOE, 'entries', '2026-11-09')));
        await assertFails(getDocs(collection(asStranger(), 'users', JOE, 'entries')));
    });

    it('cannot see or restore another user\'s deleted to-dos', async () => {
        await assertFails(getDocs(collection(asStranger(), 'users', JOE, 'todoTrash')));
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'todos', 't1'), { text: 'x' }));
    });

    it('cannot read or plant suggestions in another user\'s diary', async () => {
        await assertFails(getDocs(collection(asStranger(), 'users', JOE, 'agentProposals')));
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'agentProposals', 'x'), { kind: 'todo', text: 'Send money', status: 'pending' }));
    });

    it('cannot write into another user\'s diary', async () => {
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'entries', 'x'), { content: 'hi' }));
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'settings', 'general'), { geminiApiKey: 'x' }));
    });

    it('cannot even use their own space without being allowlisted (sign-up is closed)', async () => {
        await assertFails(setDoc(doc(asStranger(), 'users', STRANGER, 'entries', 'x'), { content: 'hi' }));
        await assertFails(getDocs(collection(asStranger(), 'users', STRANGER, 'entries')));
    });

    it('cannot add themselves to the allowlist or read anyone else\'s entry', async () => {
        await assertFails(setDoc(doc(asStranger(), 'allowedUsers', STRANGER), {}));
        await assertFails(getDoc(doc(asStranger(), 'allowedUsers', JOE)));
        await assertFails(getDocs(collection(asStranger(), 'allowedUsers')));
        await assertFails(setDoc(doc(asJoe(), 'allowedUsers', STRANGER), {}));
        await assertFails(setDoc(doc(asJoe(), 'allowedUsers', JOE), { note: 'changed' }));
    });
});

describe('allowlist self-check (used by the calendar proxy)', () => {
    it('lets a signed-in user read only their own allowlist entry', async () => {
        await assertSucceeds(getDoc(doc(asJoe(), 'allowedUsers', JOE)));
        // A stranger may look up their own (missing) entry; it simply does not exist.
        await assertSucceeds(getDoc(doc(asStranger(), 'allowedUsers', STRANGER)));
        await assertFails(getDoc(doc(asAnonymous(), 'allowedUsers', JOE)));
    });
});

describe('gateway usage counters', () => {
    it('are invisible to every client, including the owner', async () => {
        await assertFails(getDoc(doc(asJoe(), 'gatewayUsage', `${JOE}_2026-11-09`)));
        await assertFails(setDoc(doc(asJoe(), 'gatewayUsage', `${JOE}_2026-11-09`), { count: 0 }));
        await assertFails(getDoc(doc(asJoe(), 'gatewayUsage', `mcp_${JOE}_2026-11-09`)));
    });
});

describe('connections to outside apps (MCP sign-in)', () => {
    beforeEach(async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'mcpGrants', 'g1'), { uid: JOE, scopes: ['diary.read'] });
            await setDoc(doc(db, 'mcpTokens', 'hash1'), { uid: JOE, grantId: 'g1', kind: 'access' });
        });
    });

    it('are server-only: no client can read, create, widen or delete grants, codes, tokens or clients', async () => {
        for (const db of [asJoe(), asStranger(), asAnonymous()]) {
            await assertFails(getDoc(doc(db, 'mcpGrants', 'g1')));
            await assertFails(getDocs(collection(db, 'mcpGrants')));
            await assertFails(setDoc(doc(db, 'mcpGrants', 'g1'), { uid: JOE, scopes: ['diary.read', 'diary.suggest'] }));
            await assertFails(deleteDoc(doc(db, 'mcpGrants', 'g1')));
            await assertFails(getDoc(doc(db, 'mcpTokens', 'hash1')));
            await assertFails(setDoc(doc(db, 'mcpTokens', 'hash2'), { uid: JOE, kind: 'access' }));
            await assertFails(setDoc(doc(db, 'mcpCodes', 'c1'), { uid: JOE }));
            await assertFails(setDoc(doc(db, 'mcpClients', 'x'), { redirectUris: ['https://evil.example'] }));
        }
    });
});

describe('signed-out visitors', () => {
    it('cannot read or write anything', async () => {
        await assertFails(getDoc(doc(asAnonymous(), 'users', JOE, 'entries', '2026-11-09')));
        await assertFails(setDoc(doc(asAnonymous(), 'users', JOE, 'entries', 'x'), {}));
        await assertFails(getDoc(doc(asAnonymous(), 'someOtherCollection', 'x')));
    });
});
