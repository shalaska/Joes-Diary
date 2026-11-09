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
    });
});

describe('other users', () => {
    it('cannot read another user\'s entries', async () => {
        await assertFails(getDoc(doc(asStranger(), 'users', JOE, 'entries', '2026-11-09')));
        await assertFails(getDocs(collection(asStranger(), 'users', JOE, 'entries')));
    });

    it('cannot write into another user\'s diary', async () => {
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'entries', 'x'), { content: 'hi' }));
        await assertFails(setDoc(doc(asStranger(), 'users', JOE, 'settings', 'general'), { geminiApiKey: 'x' }));
    });

    it('cannot even use their own space without being allowlisted (sign-up is closed)', async () => {
        await assertFails(setDoc(doc(asStranger(), 'users', STRANGER, 'entries', 'x'), { content: 'hi' }));
        await assertFails(getDocs(collection(asStranger(), 'users', STRANGER, 'entries')));
    });

    it('cannot add themselves to the allowlist or read it', async () => {
        await assertFails(setDoc(doc(asStranger(), 'allowedUsers', STRANGER), {}));
        await assertFails(getDoc(doc(asStranger(), 'allowedUsers', JOE)));
        await assertFails(setDoc(doc(asJoe(), 'allowedUsers', STRANGER), {}));
    });
});

describe('signed-out visitors', () => {
    it('cannot read or write anything', async () => {
        await assertFails(getDoc(doc(asAnonymous(), 'users', JOE, 'entries', '2026-11-09')));
        await assertFails(setDoc(doc(asAnonymous(), 'users', JOE, 'entries', 'x'), {}));
        await assertFails(getDoc(doc(asAnonymous(), 'someOtherCollection', 'x')));
    });
});
