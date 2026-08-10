import Dexie from 'dexie';

export const db = new Dexie('JoesDiaryDB');

db.version(1).stores({
    entries: 'date, content', // Primary key is date (string ISO)
    trash: 'date, content, deletedAt' // Primary key is date
});

db.version(2).stores({
    entries: 'date, content',
    trash: 'date, content, deletedAt',
    calendarCache: 'key, updatedAt'
});

// Migration function
export const migrateFromLocalStorage = async () => {
    const MIGRATION_KEY = 'diary_migrated_to_dexie';

    if (localStorage.getItem(MIGRATION_KEY)) {
        return; // Already migrated
    }

    console.log("Migrating data from LocalStorage to IndexedDB...");

    try {
        // 1. Migrate Entries
        const savedEntries = localStorage.getItem('diary_entries');
        if (savedEntries) {
            const parsedEntries = JSON.parse(savedEntries);
            if (Array.isArray(parsedEntries) && parsedEntries.length > 0) {
                await db.entries.bulkPut(parsedEntries);
                console.log(`Migrated ${parsedEntries.length} entries.`);
            }
        }

        // 2. Migrate Trash
        const savedTrash = localStorage.getItem('diary_trash');
        if (savedTrash) {
            const parsedTrash = JSON.parse(savedTrash);
            if (Array.isArray(parsedTrash) && parsedTrash.length > 0) {
                await db.trash.bulkPut(parsedTrash);
                console.log(`Migrated ${parsedTrash.length} trash items.`);
            }
        }

        // 3. Mark as migrated
        localStorage.setItem(MIGRATION_KEY, 'true');

        // Optional: Clear old data to free up space, but maybe keep as backup for now?
        // localStorage.removeItem('diary_entries');
        // localStorage.removeItem('diary_trash');

    } catch (error) {
        console.error("Migration failed:", error);
    }
};
