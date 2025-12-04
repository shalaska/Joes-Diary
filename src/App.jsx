import React, { useState, useEffect, useMemo } from 'react';
import DiaryEntry from './components/DiaryEntry';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import GeminiPanel from './components/GeminiPanel'; // Import GeminiPanel
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Menu, Book, Plus, Sparkles } from 'lucide-react'; // Import Sparkles

import { db as localDB } from './db'; // Rename to avoid confusion
import { firestoreService } from './firestoreService';
import { askGemini } from './services/geminiService'; // Import askGemini

function DiaryApp() {
  const { currentUser, logout } = useAuth();
  const [entries, setEntries] = useState([]);
  const [trash, setTrash] = useState([]);
  const [dayMetadata, setDayMetadata] = useState({}); // Store metadata by date string
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // Mobile menu state

  // Global Gemini State for Page-Level Analysis
  const [globalGemini, setGlobalGemini] = useState({ loading: false, suggestion: null });
  const [globalChatHistory, setGlobalChatHistory] = useState([]);

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
        let cloudMetadata = await firestoreService.getDayMetadata(currentUser.uid);

        // Convert metadata array to object for easier lookup
        const metadataMap = {};
        cloudMetadata.forEach(m => {
          metadataMap[m.id] = m;
        });

        // Default entry if absolutely nothing exists
        if (cloudEntries.length === 0 && cloudTrash.length === 0) {
          const newEntry = { date: new Date().toISOString(), content: '' };
          await firestoreService.saveEntry(currentUser.uid, newEntry);
          cloudEntries = [newEntry];
        }

        setEntries(cloudEntries);
        setTrash(cloudTrash);
        setDayMetadata(metadataMap);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initData();
  }, [currentUser]);

  // Group entries by groupId (or fallback to date string for legacy)
  const groupedEntries = useMemo(() => {
    const groups = {};
    entries.forEach(entry => {
      // Use groupId if available, otherwise fallback to date string (legacy behavior)
      const groupId = entry.groupId || new Date(entry.date).toDateString();
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(entry);
    });
    // Sort entries within each group by time descending
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    return groups;
  }, [entries]);

  // Default to the most recent group
  // selectedDate is now acting as "selectedGroupId"
  const [selectedDate, setSelectedDate] = useState(null);

  // Set initial selected date once data is loaded
  useEffect(() => {
    if (!isLoading && !selectedDate) {
      // Sort groups based on metadata (if available) or default to date descending (using the group ID if it's a date, or the latest entry in the group)
      const groupIds = Object.keys(groupedEntries).sort((a, b) => {
        const metaA = dayMetadata[a];
        const metaB = dayMetadata[b];

        if (metaA?.sortIndex !== undefined && metaB?.sortIndex !== undefined) {
          return metaA.sortIndex - metaB.sortIndex;
        }

        // Fallback sort: try to parse as date (legacy) or use creation time of newest entry
        // For new groups, the ID is an ISO string, so it sorts naturally as a date
        // For legacy groups, it's "Fri Dec 01 2023", which also parses
        return new Date(b) - new Date(a);
      });

      if (groupIds.length > 0) {
        setSelectedDate(groupIds[0]);
      }
    }
  }, [isLoading, groupedEntries, selectedDate, dayMetadata]);

  useEffect(() => {
    // If selectedDate is not in groups (e.g. all deleted), reset to first available
    if (view === 'diary' && !isLoading) {
      if (selectedDate && !groupedEntries[selectedDate]) {
        const groupIds = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(groupIds[0] || null);
      } else if (!selectedDate && Object.keys(groupedEntries).length > 0) {
        const groupIds = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(groupIds[0]);
      }
    }
  }, [groupedEntries, selectedDate, view, isLoading]);

  const refreshEntries = async () => {
    const allEntries = await firestoreService.getEntries(currentUser.uid);
    setEntries(allEntries);
    const allTrash = await firestoreService.getTrash(currentUser.uid);
    setTrash(allTrash);
  };

  const handleUpdateDayMetadata = async (groupId, newMetadata) => {
    // Optimistic update
    setDayMetadata(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], ...newMetadata }
    }));

    // Cloud update
    await firestoreService.saveDayMetadata(currentUser.uid, groupId, newMetadata);
  };

  const saveEntry = async (date, content, groupId) => {
    // Optimistic update
    setEntries(prev => prev.map(e => e.date === date ? { ...e, content, groupId } : e));

    // Cloud update
    await firestoreService.saveEntry(currentUser.uid, { date, content, groupId });
  };

  // Left Sidebar Button: Creates a NEW Group
  const createNewGroup = async () => {
    const newDate = new Date().toISOString();
    // Use the ISO string as the unique Group ID for this new session
    const newGroupId = newDate;
    const newEntry = { date: newDate, content: '', groupId: newGroupId };

    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();

    setSelectedDate(newGroupId);
    setView('diary');
  };

  // Right Header Button: Adds to CURRENT Group
  const addToCurrentGroup = async () => {
    if (!selectedDate) return createNewGroup(); // Fallback if nothing selected

    const newEntry = {
      date: new Date().toISOString(),
      content: '',
      groupId: selectedDate // selectedDate is the current groupId
    };

    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();
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

  // Page-Level Gemini Handlers
  const handleAskPage = async () => {
    if (currentDayEntries.length === 0) return;

    setGlobalGemini({ loading: true, suggestion: null });
    setGlobalChatHistory([]);

    const aggregatedContent = currentDayEntries
      .map(e => `[Entry Time: ${new Date(e.date).toLocaleTimeString()}]\n${e.content}`)
      .join('\n\n---\n\n');

    const prompt = `Here are my diary entries for today (${new Date(selectedDate).toLocaleDateString()}):\n\n${aggregatedContent}\n\nPlease analyze my day. What are the key themes, mood, or events?`;

    try {
      // We send this as the initial user prompt
      const suggestion = await askGemini(prompt);
      setGlobalGemini({ loading: false, suggestion });
      setGlobalChatHistory([
        { role: 'user', content: prompt },
        { role: 'model', content: suggestion.content }
      ]);
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setGlobalGemini({
        loading: false,
        suggestion: {
          type: 'question',
          content: "I'm having trouble analyzing your day right now. Please try again later.",
        }
      });
    }
  };

  const handleGlobalReply = async (replyText) => {
    setGlobalGemini(prev => ({ ...prev, loading: true }));
    const newHistory = [...globalChatHistory, { role: 'user', content: replyText }];
    setGlobalChatHistory(newHistory);

    try {
      const suggestion = await askGemini(replyText, newHistory);
      setGlobalGemini({ loading: false, suggestion });
      setGlobalChatHistory(prev => [...prev, { role: 'model', content: suggestion.content }]);
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setGlobalGemini(prev => ({ ...prev, loading: false }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
          <Book className="text-indigo-600" size={24} />
          <span>JoesDiary</span>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          <Menu size={24} />
        </button>
      </div>

      <Sidebar
        groupedEntries={groupedEntries}
        dayMetadata={dayMetadata} // Pass metadata
        onUpdateDayMetadata={handleUpdateDayMetadata} // Pass update handler
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date);
          setView('diary');
          setGlobalGemini({ loading: false, suggestion: null }); // Reset global gemini on date change
        }}
        onAddEntry={createNewGroup}
        onDeleteDay={deleteDay}
        currentView={view}
        onViewTrash={() => setView('trash')}
        onLogout={logout}
        userEmail={currentUser.email}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />

      <main className="flex-1 md:ml-64 p-4 md:p-12 lg:p-16 overflow-y-auto h-[calc(100vh-65px)] md:h-screen">
        <div className="max-w-3xl mx-auto">
          {view === 'trash' ? (
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 md:mb-8 border-b border-slate-200 pb-4 flex items-center gap-3">
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
              <div className="pb-20"> {/* Add padding bottom for the panel */}
                <div className="flex items-center justify-between mb-6 md:mb-8 border-b border-slate-200 pb-4">
                  <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
                    {/* Display Custom Title if available, else Date */}
                    {dayMetadata[selectedDate]?.customTitle || new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </h1>
                  <button
                    onClick={addToCurrentGroup}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95 text-sm font-medium"
                  >
                    <Plus size={18} />
                    <span className="hidden sm:inline">New Note</span>
                  </button>
                </div>
                <div className="space-y-8">
                  {currentDayEntries.map((entry, index) => (
                    <DiaryEntry
                      key={entry.date}
                      date={entry.date}
                      initialContent={entry.content}
                      onSave={(date, content) => saveEntry(date, content, entry.groupId)}
                      onDelete={deleteEntry}
                      showDateHeader={false} // We show the main date at the top
                    />
                  ))}
                </div>

                {/* Page Level Gemini Action */}
                <div className="mt-12 border-t border-slate-100 pt-8">
                  {!globalGemini.suggestion && !globalGemini.loading ? (
                    <button
                      onClick={handleAskPage}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl transition-colors font-medium border border-indigo-200 border-dashed"
                    >
                      <Sparkles size={18} />
                      <span>Ask Gemini about today</span>
                    </button>
                  ) : (
                    <GeminiPanel
                      isLoading={globalGemini.loading}
                      suggestion={globalGemini.suggestion}
                      onClose={() => setGlobalGemini({ loading: false, suggestion: null })}
                      onReply={handleGlobalReply}
                    // No onApplyTool needed for global chat usually, unless we want to append to a specific entry? 
                    // For now, let's omit it or handle it if needed.
                    />
                  )}
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
