import React, { useState, useEffect, useMemo } from 'react';
import DiaryEntry from './components/DiaryEntry';
import Sidebar from './components/Sidebar';
import Auth from './components/Auth';
import GeminiPanel from './components/GeminiPanel'; // Import GeminiPanel
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Menu, Book, Plus, Sparkles } from 'lucide-react'; // Import Sparkles
import SettingsModal from './components/SettingsModal'; // Import SettingsModal

import { db as localDB } from './db'; // Rename to avoid confusion
import { firestoreService } from './firestoreService';
import { askGemini, editSelection, DEFAULT_SYSTEM_PROMPT, DEFAULT_EDIT_PROMPT } from './services/geminiService'; // Import defaults

function DiaryApp() {
  const { currentUser, logout } = useAuth();
  const [entries, setEntries] = useState([]);
  const [trash, setTrash] = useState([]);
  const [dayMetadata, setDayMetadata] = useState({}); // Store metadata by date string
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // Mobile menu state
  const [todos, setTodos] = useState([]); // Todo State

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '');
  const [systemPrompt, setSystemPrompt] = useState(localStorage.getItem('gemini_system_prompt') || DEFAULT_SYSTEM_PROMPT);
  const [editPrompt, setEditPrompt] = useState(localStorage.getItem('gemini_edit_prompt') || DEFAULT_EDIT_PROMPT);

  // Global Gemini State for Page-Level Analysis
  const [globalGemini, setGlobalGemini] = useState({ loading: false, suggestion: null });
  const [globalChatHistory, setGlobalChatHistory] = useState([]);

  const [view, setView] = useState('diary'); // 'diary' | 'trash'

  // Title Renaming State
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleInputValue, setTitleInputValue] = useState('');

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
        setDayMetadata(metadataMap); // Load metadata into state

        const cloudTodos = await firestoreService.getTodos(currentUser.uid);
        setTodos(cloudTodos);

        // 3. Load User Settings
        const userSettings = await firestoreService.getUserSettings(currentUser.uid);
        if (userSettings) {
          if (userSettings.apiKey) {
            setApiKey(userSettings.apiKey);
            localStorage.setItem('gemini_api_key', userSettings.apiKey);
          }
          if (userSettings.systemPrompt) {
            setSystemPrompt(userSettings.systemPrompt);
            localStorage.setItem('gemini_system_prompt', userSettings.systemPrompt);
          }
          if (userSettings.editPrompt) {
            setEditPrompt(userSettings.editPrompt);
            localStorage.setItem('gemini_edit_prompt', userSettings.editPrompt);
          }
        }

        setIsLoading(false);
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

  const handleSaveSettings = async (newKey, newPrompt, newEditPrompt) => {
    setApiKey(newKey);
    setSystemPrompt(newPrompt);
    setEditPrompt(newEditPrompt);
    localStorage.setItem('gemini_api_key', newKey);
    localStorage.setItem('gemini_system_prompt', newPrompt);
    localStorage.setItem('gemini_edit_prompt', newEditPrompt);

    // Sync to Firestore
    await firestoreService.saveUserSettings(currentUser.uid, {
      apiKey: newKey,
      systemPrompt: newPrompt,
      editPrompt: newEditPrompt
    });
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

  const deleteGroup = async (groupId) => {
    const entriesToDelete = entries.filter(entry => {
      const entryGroupId = entry.groupId || new Date(entry.date).toDateString();
      return entryGroupId === groupId;
    });

    if (entriesToDelete.length > 0) {
      await firestoreService.deleteDay(currentUser.uid, entriesToDelete);
      await refreshEntries();
    }

    // If we deleted the currently selected group, switch to another one
    if (selectedDate === groupId) {
      setSelectedDate(null); // Effect will handle picking a new default
    }
    if (selectedDate === groupId) {
      setSelectedDate(null); // Effect will handle picking a new default
    }
  };

  // Todo Handlers
  const handleAddTodos = async (newTodos) => {
    // Optimistic update
    const todosWithIds = newTodos.map(t => ({ ...t, id: Date.now() + Math.random().toString(36).substr(2, 9) + "-" + Math.random().toString(36).substr(2, 9), created: new Date().toISOString() }));
    setTodos(prev => [...prev, ...todosWithIds]);

    // Cloud update
    for (const todo of todosWithIds) {
      await firestoreService.saveTodo(currentUser.uid, todo);
    }
  };

  const handleToggleTodo = async (todoId, completed) => {
    setTodos(prev => prev.map(t => t.id === todoId ? { ...t, completed } : t));
    await firestoreService.updateTodo(currentUser.uid, todoId, { completed });
  };

  const handleDeleteTodo = async (todoId) => {
    setTodos(prev => prev.filter(t => t.id !== todoId));
    await firestoreService.deleteTodo(currentUser.uid, todoId);
  };


  const currentDayEntries = groupedEntries[selectedDate] || [];

  // Page-Level Gemini Handlers
  const handleAskPage = () => {
    if (currentDayEntries.length === 0) return;
    setGlobalGemini({ loading: false, suggestion: null, isWaitingForPrompt: true });
    setGlobalChatHistory([]);
  };

  const handleConfirmAskPage = async (customPrompt) => {
    setGlobalGemini({ loading: true, suggestion: null, isWaitingForPrompt: false });

    const aggregatedContent = currentDayEntries
      .map(e => `[Entry Time: ${new Date(e.date).toLocaleTimeString()}]\n${e.content}`)
      .join('\n\n---\n\n');

    let prompt = '';
    if (customPrompt) {
      prompt = `Here are my diary entries for today (${new Date(selectedDate).toLocaleDateString()}):\n\n${aggregatedContent}\n\nQuestion: ${customPrompt}`;
    } else {
      prompt = `Here are my diary entries for today (${new Date(selectedDate).toLocaleDateString()}):\n\n${aggregatedContent}\n\nPlease analyze my day. What are the key themes, mood, or events?`;
    }

    try {
      // We send this as the initial user prompt
      const suggestion = await askGemini(prompt, [], apiKey, systemPrompt);
      setGlobalGemini({ loading: false, suggestion, isWaitingForPrompt: false });

      if (customPrompt) {
        setGlobalChatHistory([
          { role: 'user', content: customPrompt },
          { role: 'model', content: suggestion.content }
        ]);
      } else {
        // If default analysis, we might just show the result, or show a generic prompt in history
        // Let's mimic what we did before: show the initial prompt (or maybe just the Question?)
        // If we show the HUGE context prompt, it's ugly.
        // Let's just show "Analyze my day" as the user prompt in history if it was default.
        setGlobalChatHistory([
          { role: 'user', content: "Analyze my day" },
          { role: 'model', content: suggestion.content }
        ]);
      }

    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setGlobalGemini({
        loading: false,
        isWaitingForPrompt: false,
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
      const suggestion = await askGemini(replyText, newHistory, apiKey, systemPrompt);
      setGlobalGemini({ loading: false, suggestion });
      setGlobalChatHistory(prev => [...prev, { role: 'model', content: suggestion.content }]);
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      setGlobalGemini(prev => ({ ...prev, loading: false }));
    }
  };

  const handleSaveGlobalAnalysis = async () => {
    if (!globalGemini.suggestion) return;

    let textToSave = '';

    // If we have history, format it as a conversation
    if (globalChatHistory.length > 0) {
      // We want to capture the full context of the analysis
      // The first message in history is the prompt "Here are my diary entries..." which might be too long/repetitive to save?
      // Actually, the user probably just wants the *Analysis* (the response).
      // But if they had a back-and-forth, they might want that too.

      // Let's format it similarly to the DiaryEntry "Add to Note"
      // But since this is a NEW note, we might want a header.

      textToSave = `# Gemini Analysis\n\n`;

      // Filter out the initial huge prompt if it's just raw data dump? 
      // The initial prompt is: "Here are my diary entries..."
      // Maybe we just save the Model's response if it's the first turn?

      globalChatHistory.forEach(msg => {
        // Skip the very first user message if it starts with "Here are my diary entries" to avoid clutter
        if (msg.role === 'user' && msg.content.startsWith("Here are my diary entries")) {
          return;
        }

        if (msg.role === 'user') {
          textToSave += `> **User:** ${msg.content}\n\n`;
        } else {
          textToSave += `> **Gemini:** ${msg.content}\n\n`;
        }
      });

      // Add the current suggestion if it's not in history yet (it usually isn't added to history until next reply)
      // Wait, handleGlobalReply adds to history. handleAskPage adds to history.
      // Let's check handleAskPage:
      // setGlobalChatHistory([ { role: 'user', content: prompt }, { role: 'model', content: suggestion.content } ]);
      // So the current suggestion IS in history?
      // handleAskPage sets history WITH the suggestion.
      // handleGlobalReply sets history THEN asks, then appends result.
      // So `globalChatHistory` should be up to date? 
      // Actually handleGlobalReply appends the *new* model response to history at the end.

      // But `globalGemini.suggestion` is the *latest* response.
      // If we just use `globalChatHistory`, we should be good.

      // However, `handleAskPage` sets history:
      // setGlobalChatHistory([ { role: 'user', content: prompt }, { role: 'model', content: suggestion.content } ]);

      // So yes, history contains everything.
    } else {
      // Should not happen if handleAskPage sets history, but fallback:
      textToSave = `> **Gemini:** ${globalGemini.suggestion.content}`;
    }

    // Create a new entry with this content
    const newEntry = {
      date: new Date().toISOString(),
      content: textToSave,
      groupId: selectedDate, // Add to current group
      type: 'analysis' // Mark as analysis to pin to bottom
    };

    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();

    // Close the panel? Or just show success?
    // Let's close it to indicate completion
    setGlobalGemini({ loading: false, suggestion: null });
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
        onDeleteDay={deleteGroup}
        currentView={view}
        onViewTrash={() => setView('trash')}
        onLogout={logout}
        userEmail={currentUser.email}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onSettings={() => setIsSettingsOpen(true)}
        // Todo Props
        todos={todos}
        onToggleTodo={handleToggleTodo}
        onDeleteTodo={handleDeleteTodo}
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
                  <div className="flex-1 mr-4">
                    {isRenamingTitle ? (
                      <input
                        type="text"
                        value={titleInputValue}
                        onChange={(e) => setTitleInputValue(e.target.value)}
                        onBlur={() => {
                          handleUpdateDayMetadata(selectedDate, { customTitle: titleInputValue });
                          setIsRenamingTitle(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleUpdateDayMetadata(selectedDate, { customTitle: titleInputValue });
                            setIsRenamingTitle(false);
                          } else if (e.key === 'Escape') {
                            setIsRenamingTitle(false);
                            setTitleInputValue(dayMetadata[selectedDate]?.customTitle || '');
                          }
                        }}
                        autoFocus
                        className="text-2xl md:text-3xl font-bold text-slate-900 w-full bg-transparent border-b-2 border-indigo-500 outline-none pb-1"
                      />
                    ) : (
                      <h1
                        className="text-2xl md:text-3xl font-bold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors flex items-center gap-2 group"
                        onClick={() => {
                          setTitleInputValue(dayMetadata[selectedDate]?.customTitle || '');
                          setIsRenamingTitle(true);
                        }}
                        title="Click to rename"
                      >
                        {dayMetadata[selectedDate]?.customTitle || new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        <span className="opacity-0 group-hover:opacity-100 text-slate-400 text-sm font-normal">
                          (Rename)
                        </span>
                      </h1>
                    )}
                  </div>
                  <button
                    onClick={addToCurrentGroup}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg transition-all shadow-md hover:shadow-lg active:scale-95 text-sm font-medium whitespace-nowrap"
                  >
                    <Plus size={18} />
                    <span className="hidden sm:inline">New Note</span>
                  </button>
                </div>
                <div className="space-y-8">
                  {currentDayEntries
                    .filter(e => e.type !== 'analysis')
                    .map((entry, index) => (
                      <DiaryEntry
                        key={entry.date}
                        date={entry.date}
                        initialContent={entry.content}
                        onSave={(date, content) => saveEntry(date, content, entry.groupId || new Date(entry.date).toDateString())}
                        onDelete={deleteEntry}
                        showDateHeader={false} // We show the main date at the top
                        apiKey={apiKey} // Pass API key
                        systemPrompt={systemPrompt} // Pass system prompt
                        editPrompt={editPrompt} // Pass edit prompt
                        onAddTodos={handleAddTodos} // Pass todo handler
                      />
                    ))}

                  {/* Render Analysis Entries at the bottom */}
                  {currentDayEntries
                    .filter(e => e.type === 'analysis')
                    .map((entry, index) => (
                      <DiaryEntry
                        key={entry.date}
                        date={entry.date}
                        initialContent={entry.content}
                        onSave={(date, content) => saveEntry(date, content, entry.groupId || new Date(entry.date).toDateString())}
                        onDelete={deleteEntry}
                        showDateHeader={false}
                        isAnalysis={true} // Optional: Pass a prop if we want special styling
                        apiKey={apiKey}
                        systemPrompt={systemPrompt}
                        editPrompt={editPrompt}
                        onAddTodos={handleAddTodos}
                      />
                    ))}
                </div>

                {/* Page Level Gemini Action */}
                <div className="mt-12 border-t border-slate-100 pt-8">
                  {!globalGemini.suggestion && !globalGemini.loading && !globalGemini.isWaitingForPrompt ? (
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
                      isWaitingForPrompt={globalGemini.isWaitingForPrompt}
                      onAsk={handleConfirmAskPage}
                      onClose={() => setGlobalGemini({ loading: false, suggestion: null, isWaitingForPrompt: false })}
                      onReply={handleGlobalReply}
                      onAddToNote={handleSaveGlobalAnalysis}
                      saveLabel="Save as Note"
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
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialApiKey={apiKey}
        initialSystemPrompt={systemPrompt}
        initialEditPrompt={editPrompt}
      />
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
