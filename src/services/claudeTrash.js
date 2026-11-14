import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

// To-dos Claude deleted through the connector wait in users/{uid}/todoTrash for 7 days, so a
// wrong delete can be undone here. Expired ones are cleared when this list loads.
export const loadClaudeTrash = async (uid, now = Date.now()) => {
    const snapshot = await getDocs(collection(db, 'users', uid, 'todoTrash'));
    const items = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    const expired = items.filter(t => !(t.expiresAt > now));
    if (expired.length) {
        const batch = writeBatch(db);
        expired.forEach(t => batch.delete(doc(db, 'users', uid, 'todoTrash', t.id)));
        await batch.commit().catch(() => {});
    }
    return items.filter(t => t.expiresAt > now).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
};

export const restoreClaudeTrash = async (uid, item) => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'todos', item.id), item.todo);
    batch.delete(doc(db, 'users', uid, 'todoTrash', item.id));
    await batch.commit();
    return item.todo;
};
