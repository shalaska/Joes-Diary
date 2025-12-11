import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    orderBy,
    writeBatch
} from 'firebase/firestore';

export const firestoreService = {
    async getEntries(userId) {
        const q = query(collection(db, 'users', userId, 'entries'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    },

    async getTrash(userId) {
        const q = query(collection(db, 'users', userId, 'trash'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    },

    async saveEntry(userId, entry) {
        // Use date string as ID for easy access/deduplication
        const entryRef = doc(db, 'users', userId, 'entries', entry.date);
        await setDoc(entryRef, entry);
    },

    async deleteEntry(userId, entry) {
        const batch = writeBatch(db);

        // 1. Add to trash
        const trashRef = doc(db, 'users', userId, 'trash', entry.date);
        batch.set(trashRef, { ...entry, deletedAt: new Date().toISOString() });

        // 2. Delete from entries
        const entryRef = doc(db, 'users', userId, 'entries', entry.date);
        batch.delete(entryRef);

        await batch.commit();
    },

    async deleteDay(userId, entries) {
        const batch = writeBatch(db);

        entries.forEach(entry => {
            // 1. Add to trash (if content exists)
            if (entry.content && entry.content.trim()) {
                const trashRef = doc(db, 'users', userId, 'trash', entry.date);
                batch.set(trashRef, { ...entry, deletedAt: new Date().toISOString() });
            }

            // 2. Delete from entries
            const entryRef = doc(db, 'users', userId, 'entries', entry.date);
            batch.delete(entryRef);
        });

        await batch.commit();
    },

    async migrateFromDexie(userId, localEntries, localTrash) {
        const batch = writeBatch(db);
        let count = 0;
        const BATCH_LIMIT = 450; // Firestore batch limit is 500

        // Migrate Entries
        for (const entry of localEntries) {
            if (count >= BATCH_LIMIT) {
                await batch.commit();
                count = 0;
            }
            const ref = doc(db, 'users', userId, 'entries', entry.date);
            batch.set(ref, entry);
            count++;
        }

        // Migrate Trash
        for (const item of localTrash) {
            if (count >= BATCH_LIMIT) {
                await batch.commit();
                count = 0;
            }
            const ref = doc(db, 'users', userId, 'trash', item.date);
            batch.set(ref, item);
            count++;
        }

        if (count > 0) {
            await batch.commit();
        }
    },

    async getDayMetadata(userId) {
        const q = query(collection(db, 'users', userId, 'dayMetadata'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    },

    async saveDayMetadata(userId, dateStr, metadata) {
        const ref = doc(db, 'users', userId, 'dayMetadata', dateStr);
        // Merge true to allow partial updates if we add more fields later
        await setDoc(ref, metadata, { merge: true });
    },

    async getUserSettings(userId) {
        const ref = doc(db, 'users', userId, 'settings', 'general');
        const snapshot = await getDocs(query(collection(db, 'users', userId, 'settings')));
        // We'll just use a single document 'general' for now
        const docSnap = await import('firebase/firestore').then(mod => mod.getDoc(ref));

        if (docSnap.exists()) {
            return docSnap.data();
        }
        return null;
    },

    async saveUserSettings(userId, settings) {
        const ref = doc(db, 'users', userId, 'settings', 'general');
        await setDoc(ref, settings, { merge: true });
    },

    // Todo Operations
    async getTodos(uid) {
        const q = query(collection(db, 'users', uid, 'todos'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },

    async saveTodo(uid, todo) {
        // If todo has an id, set it, otherwise add new
        if (todo.id) {
            const todoRef = doc(db, 'users', uid, 'todos', todo.id);
            await setDoc(todoRef, todo);
        } else {
            await addDoc(collection(db, 'users', uid, 'todos'), todo);
        }
    },

    async updateTodo(uid, todoId, updates) {
        const todoRef = doc(db, 'users', uid, 'todos', todoId);
        await updateDoc(todoRef, updates);
    },

    async deleteTodo(uid, todoId) {
        await deleteDoc(doc(db, 'users', uid, 'todos', todoId));
    }
};
