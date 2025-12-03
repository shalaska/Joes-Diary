import React, { useState, useEffect, useMemo } from 'react';
import DiaryEntry from './components/DiaryEntry';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import { db as localDB } from './db'; // Rename to avoid confusion
import { firestoreService } from './firestoreService';

function DiaryApp() {
  const { currentUser, logout } = useAuth();
  const [entries, setEntries] = useState([]);
  const [trash, setTrash] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [view, setView] = useState('diary'); // 'diary' | 'trash'

  // If not logged in, show Auth screen
  if (!currentUser) {
    return <Auth />;
  }

  // Load data from Cloud (and migrate if needed)
  useEffect(() => {
    const initData = async () => {
      setIsLoading(true);

      try {
        // 1. Check for migration
        const migrationKey = `migrated_to_cloud_${currentUser.uid}`;
        const hasMigrated = localStorage.getItem(migrationKey);

        if (!hasMigrated) {
          console.log("Checking for local data to migrate...");
          const localEntries = await localDB.entries.toArray();
          const localTrash = await localDB.trash.toArray();

          if (localEntries.length > 0 || localTrash.length > 0) {
            console.log(`Migrating ${localEntries.length} entries and ${localTrash.length} trash items to cloud...`);
            await firestoreService.migrateFromDexie(currentUser.uid, localEntries, localTrash);
          }
          localStorage.setItem(migrationKey, 'true');
        }

        // 2. Fetch from Firestore
        let cloudEntries = await firestoreService.getEntries(currentUser.uid);
        let cloudTrash = await firestoreService.getTrash(currentUser.uid);

        // Default entry if absolutely nothing exists
        if (cloudEntries.length === 0 && cloudTrash.length === 0) {
          const newEntry = { date: new Date().toISOString(), content: '' };
          await firestoreService.saveEntry(currentUser.uid, newEntry);
          cloudEntries = [newEntry];
        }

        setEntries(cloudEntries);
        setTrash(cloudTrash);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initData();
  }, [currentUser]);

  // Group entries by date string (e.g., "Fri Dec 01 2023")
  const groupedEntries = useMemo(() => {
    const groups = {};
    entries.forEach(entry => {
      const dateStr = new Date(entry.date).toDateString();
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(entry);
    });
    // Sort entries within each group by time descending
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    return groups;
  }, [entries]);

  // Default to the most recent date
  const [selectedDate, setSelectedDate] = useState(null);

  // Set initial selected date once data is loaded
  useEffect(() => {
    if (!isLoading && !selectedDate) {
      const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
      if (dates.length > 0) {
        setSelectedDate(dates[0]);
      }
    }
  }, [isLoading, groupedEntries, selectedDate]);

  useEffect(() => {
    // If selectedDate is not in groups (e.g. all deleted), reset to first available
    if (view === 'diary' && !isLoading) {
      if (selectedDate && !groupedEntries[selectedDate]) {
        const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(dates[0] || null);
      } else if (!selectedDate && Object.keys(groupedEntries).length > 0) {
        const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(dates[0]);
      }
    }
  }, [groupedEntries, selectedDate, view, isLoading]);

  const refreshEntries = async () => {
    const allEntries = await firestoreService.getEntries(currentUser.uid);
    setEntries(allEntries);
    const allTrash = await firestoreService.getTrash(currentUser.uid);
    setTrash(allTrash);
  };

  const saveEntry = async (date, content) => {
    // Optimistic update
    setEntries(prev => prev.map(e => e.date === date ? { ...e, content } : e));

    // Cloud update
    await firestoreService.saveEntry(currentUser.uid, { date, content });
  };

  const addEntry = async () => {
    const newEntry = { date: new Date().toISOString(), content: '' };

    // Optimistic UI update (optional, but safer to wait for DB in this case to ensure ID consistency if we used generated IDs, but we use date as ID)
    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();

    // Select the day of the new entry (which is today)
    setSelectedDate(new Date(newEntry.date).toDateString());
    setView('diary');
  };

  const deleteEntry = async (entryDate) => {
    const entryToDelete = entries.find(e => e.date === entryDate);

    if (entryToDelete) {
      await firestoreService.deleteEntry(currentUser.uid, entryToDelete);
      await refreshEntries();
    }
  };

  const deleteDay = async (dateStr) => {
    const entriesToDelete = entries.filter(entry => new Date(entry.date).toDateString() === dateStr);

    if (entriesToDelete.length > 0) {
      await firestoreService.deleteDay(currentUser.uid, entriesToDelete);
      await refreshEntries();
    }

    // If we deleted the currently selected date, switch to another one
    if (selectedDate === dateStr) {
      setSelectedDate(null); // Effect will handle picking a new default
    }
  };

  const currentDayEntries = groupedEntries[selectedDate] || [];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar
        groupedEntries={groupedEntries}
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date);
          setView('diary');
        }}
        onAddEntry={addEntry}
        onDeleteDay={deleteDay}
        currentView={view}
        onViewTrash={() => setView('trash')}
        onLogout={logout}
        userEmail={currentUser.email}
      />

      <main className="flex-1 ml-64 p-8 sm:p-12 lg:p-16 overflow-y-auto h-screen">
        <div className="max-w-3xl mx-auto">
          {view === 'trash' ? (
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-8 border-b border-slate-200 pb-4 flex items-center gap-3">
                <span className="text-slate-400">Trash</span>
                <span className="text-sm font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{trash.length} items</span>
              </h1>
              {trash.length > 0 ? (
                <div className="space-y-6">
                  {trash.map((entry) => (
                    <div key={entry.date} className="bg-white rounded-xl p-6 border border-slate-200 opacity-75 hover:opacity-100 transition-opacity">
                      <div className="text-sm text-indigo-600 font-medium mb-2">
                        {new Date(entry.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                      <p className="text-slate-600 whitespace-pre-wrap">{entry.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-400 mt-20">
                  <p>Trash is empty.</p>
                </div>
              )}
            </div>
          ) : (
            currentDayEntries.length > 0 ? (
              <div>
                <h1 className="text-3xl font-bold text-slate-900 mb-8 border-b border-slate-200 pb-4">
                  {new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </h1>
                <div className="space-y-8">
                  {currentDayEntries.map((entry, index) => (
                    <DiaryEntry
                      key={entry.date}
                      date={entry.date}
                      initialContent={entry.content}
                      onSave={saveEntry}
                      onDelete={deleteEntry}
                      showDateHeader={false} // We show the main date at the top
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center text-slate-400 mt-20">
                <p>Select a day or create a new entry.</p>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DiaryApp />
    </AuthProvider>
  );
}
