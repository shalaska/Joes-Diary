// One user's diary, read and suggested-to through the Admin SDK. Every path is under
// users/{uid}, so a caller can only ever reach the uid it was built for. Shared by
// "Ask my diary" and the MCP server.
export const createUserStore = (db, uid, now = () => Date.now()) => {
    const base = `users/${uid}`;
    return {
        entries: async () => (await db.collection(`${base}/entries`).get()).docs.map(d => d.data()),
        todos: async () => (await db.collection(`${base}/todos`).get()).docs.map(d => ({ ...d.data(), id: d.id })),
        saveProposals: async (proposals) => {
            const batch = db.batch();
            const refs = proposals.map(() => db.collection(`${base}/agentProposals`).doc());
            refs.forEach((ref, i) => batch.set(ref, proposals[i]));
            await batch.commit();
            return refs.map(ref => ref.id);
        },
        // The change permission's writes: to-dos, and new week-review entries. The app keys
        // entries by their ISO date and to-dos carry their own id, like the app writes them.
        addTodo: async (todo) => {
            const ref = db.collection(`${base}/todos`).doc();
            await ref.set({ ...todo, id: ref.id });
            return ref.id;
        },
        updateTodo: async (id, fields) => { await db.doc(`${base}/todos/${id}`).update(fields); },
        deleteTodo: async (id) => { await db.doc(`${base}/todos/${id}`).delete(); },
        // Counts Claude's changes per UTC day in a server-only counter; false once at the limit.
        takeChange: (limit) => {
            const ref = db.doc(`gatewayUsage/mcpchanges_${uid}_${new Date(now()).toISOString().slice(0, 10)}`);
            return db.runTransaction(async (tx) => {
                const count = (await tx.get(ref)).get('count') || 0;
                if (count >= limit) return false;
                tx.set(ref, { count: count + 1 }, { merge: true });
                return true;
            });
        },
        saveEntry: async (entry) => {
            await db.doc(`${base}/entries/${entry.date}`).create(entry);
            return entry.date;
        },
        // Suggestions still waiting for the user: pending and not past their expiry.
        pendingProposalCount: async () => {
            const snapshot = await db.collection(`${base}/agentProposals`).where('status', '==', 'pending').get();
            return snapshot.docs.filter(d => !d.get('expiresAt') || Date.parse(d.get('expiresAt')) > now()).length;
        },
    };
};

// The sign-in server's records, in top-level collections that the Firestore rules deny to
// every client (only this server, through the Admin SDK, can read them):
// - mcpClients/{clientId}: apps registered with dynamic client registration.
// - mcpGrants/{grantId}: one connection: whose, which app, which permissions, when last used.
// - mcpCodes/{sha256(code)} and mcpTokens/{sha256(token)}: never the codes or tokens themselves.
// Each code and token also gets deleteAfter (a Firestore timestamp), for a TTL policy to clear
// expired ones.
export const createOAuthStore = (db) => {
    const DAY = 864e5;
    const withTtl = (doc) => ({ ...doc, deleteAfter: new Date(doc.expiresAt + DAY) });
    // Marks a code or token used, in a transaction, so two requests cannot both be the first.
    const markUsed = (path) => db.runTransaction(async (tx) => {
        const ref = db.doc(path);
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return null;
        const doc = snapshot.data();
        if (doc.used) return { doc, firstUse: false };
        tx.update(ref, { used: true });
        return { doc, firstUse: true };
    });
    const deleteWhere = async (collection, grantId, batch) => {
        const snapshot = await db.collection(collection).where('grantId', '==', grantId).get();
        snapshot.docs.forEach(d => batch.delete(d.ref));
    };
    return {
        getClient: async (id) => (await db.doc(`mcpClients/${id}`).get()).data() ?? null,
        saveClient: async (id, doc) => { await db.doc(`mcpClients/${id}`).set(doc); },
        saveCode: async (hash, doc) => { await db.doc(`mcpCodes/${hash}`).set(withTtl(doc)); },
        useCode: (hash) => markUsed(`mcpCodes/${hash}`),
        saveToken: async (hash, doc) => { await db.doc(`mcpTokens/${hash}`).set(withTtl(doc)); },
        getToken: async (hash) => (await db.doc(`mcpTokens/${hash}`).get()).data() ?? null,
        useToken: (hash) => markUsed(`mcpTokens/${hash}`),
        getGrant: async (id) => (await db.doc(`mcpGrants/${id}`).get()).data() ?? null,
        saveGrant: async (id, doc) => { await db.doc(`mcpGrants/${id}`).set(doc); },
        // update, not set: a grant revoked a moment ago must not come back.
        updateGrant: async (id, fields) => { await db.doc(`mcpGrants/${id}`).update(fields); },
        listGrants: async (uid) => (await db.collection('mcpGrants').where('uid', '==', uid).get()).docs.map(d => ({ id: d.id, ...d.data() })),
        // Ends a connection: the grant, and every token and code issued under it.
        deleteGrant: async (id) => {
            const batch = db.batch();
            batch.delete(db.doc(`mcpGrants/${id}`));
            await deleteWhere('mcpTokens', id, batch);
            await deleteWhere('mcpCodes', id, batch);
            await batch.commit();
        },
    };
};
