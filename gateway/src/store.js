// One user's diary, read and suggested-to through the Admin SDK. Every path is under
// users/{uid}, so a caller can only ever reach the uid it was built for. Shared by
// "Ask my diary" and the MCP server.
export const createUserStore = (db, uid, now = () => Date.now()) => {
    const base = `users/${uid}`;
    return {
        entries: async () => (await db.collection(`${base}/entries`).get()).docs.map(d => d.data()),
        todos: async () => (await db.collection(`${base}/todos`).get()).docs.map(d => d.data()),
        saveProposals: async (proposals) => {
            const batch = db.batch();
            const refs = proposals.map(() => db.collection(`${base}/agentProposals`).doc());
            refs.forEach((ref, i) => batch.set(ref, proposals[i]));
            await batch.commit();
            return refs.map(ref => ref.id);
        },
        // Suggestions still waiting for the user: pending and not past their expiry.
        pendingProposalCount: async () => {
            const snapshot = await db.collection(`${base}/agentProposals`).where('status', '==', 'pending').get();
            return snapshot.docs.filter(d => !d.get('expiresAt') || Date.parse(d.get('expiresAt')) > now()).length;
        },
    };
};
