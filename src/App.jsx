import React, { useState, useEffect, useMemo } from 'react';
import DiaryEntry from './components/DiaryEntry';
import Sidebar from './components/Sidebar';
import TodoSection from './components/TodoSection';
import Auth from './components/Auth';
import GeminiPanel from './components/GeminiPanel';
import CalendarPanel from './components/CalendarPanel';
import ScheduleTodoModal from './components/ScheduleTodoModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Menu, Book, Plus, Sparkles, ListTodo, CheckCircle2, X } from 'lucide-react';
import SettingsModal from './components/SettingsModal';

import { db as localDB } from './db';
import { firestoreService } from './firestoreService';
import { askGemini, editSelection, extractTodos, createCalendarDiaryNote, createCalendarObservation, DEFAULT_SYSTEM_PROMPT, DEFAULT_EDIT_PROMPT } from './services/geminiService';
import { initializeGapiClient, gisLoaded, handleAuthClick, handleSignoutClick, addEvent, isReady, tryRestoreSession } from './services/googleCalendarService';

const buildTodos = (newTodos) => {
  const now = Date.now();
  return newTodos.map((todo, index) => ({
    text: todo.text,
    priority: todo.priority || 'medium',
    completed: todo.completed || false,
    id: `${now + index}-${Math.random().toString(36).slice(2, 11)}`,
    created: new Date().toISOString(),
    sortIndex: now + index
  }));
};

const quickTodoFromHash = () => {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const text = new URLSearchParams(hash).get('quickTodo')?.trim();
  return text ? text.slice(0, 1000) : '';
};

function DiaryApp() {
  const { currentUser, logout } = useAuth();
  const [entries, setEntries] = useState([]);
  const [trash, setTrash] = useState([]);
  const [dayMetadata, setDayMetadata] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [todos, setTodos] = useState([]);
  const [quickCaptureMessage, setQuickCaptureMessage] = useState('');
  const [quickCaptureFailed, setQuickCaptureFailed] = useState(false);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '');
  const [systemPrompt, setSystemPrompt] = useState(localStorage.getItem('gemini_system_prompt') || DEFAULT_SYSTEM_PROMPT);
  const [editPrompt, setEditPrompt] = useState(localStorage.getItem('gemini_edit_prompt') || DEFAULT_EDIT_PROMPT);

  // Google Calendar State
  const [googleClientId, setGoogleClientId] = useState(localStorage.getItem('google_client_id') || '');
  const [googleApiKey, setGoogleApiKey] = useState(localStorage.getItem('google_api_key') || '');
  const [isCalendarSignedIn, setIsCalendarSignedIn] = useState(false);
  const [isCalendarConfigured, setIsCalendarConfigured] = useState(false);

  // Todo Scheduling State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [todoToSchedule, setTodoToSchedule] = useState(null);
  const [calendarActionDate, setCalendarActionDate] = useState(null);

  // Global Gemini State
  const [globalGemini, setGlobalGemini] = useState({ loading: false, suggestion: null });
  const [globalChatHistory, setGlobalChatHistory] = useState([]);

  const [view, setView] = useState('diary'); // 'diary' | 'trash' | 'todos'

  // Title Renaming State
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [titleInputValue, setTitleInputValue] = useState('');

  // -------------------------------------------------------------------------
  // Google Calendar Initialization
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (googleClientId && googleApiKey) {
      setIsCalendarConfigured(true);

      const initGoogle = async () => {
        try {
          // Initialize GAPI
          await initializeGapiClient(googleApiKey);

          // Try to restore session
          const restored = tryRestoreSession();
          if (restored) {
            setIsCalendarSignedIn(true);
          }

          // Initialize GIS
          gisLoaded(googleClientId, (response) => {
            // Token received
            if (response && response.access_token) {
              setIsCalendarSignedIn(true);
              // Save token to localStorage for persistence
              localStorage.setItem('google_calendar_token', JSON.stringify(response));
              // Save expiry (expires_in is in seconds)
              const expiryTime = Date.now() + (response.expires_in * 1000);
              localStorage.setItem('google_calendar_token_expiry', expiryTime.toString());
            }
          });

        } catch (error) {
          console.error("Error initializing Google scripts", error);
        }
      };

      // Load scripts if not present (handled in index.html, but we wait for global objects)
      if (window.gapi && window.google) {
        initGoogle();
      } else {
        // Retry or wait - relying on script tags in index.html usually works if async defer.
        // We can add a simple timeout or polling if needed, but index.html scripts usually load fast.
        const interval = setInterval(() => {
          if (window.gapi && window.google) {
            clearInterval(interval);
            initGoogle();
          }
        }, 500);
      }
    } else {
      setIsCalendarConfigured(false);
    }
  }, [googleClientId, googleApiKey]);

  const handleCalendarSignIn = () => {
    handleAuthClick();
    // We'll optimistically set signed in, or wait for the callback in gisLoaded
    // Actually, handleAuthClick triggers the popup. The callback passed to gisLoaded handles the response.
    // So we need to ensure local state updates when that callback fires.
    // Modifying the callback in the effect above to update state.
    // However, the token client is init'd once. 
    // For this MVP, let's assume successful flow updates state via the callback we defined in useEffect (but we can't easily change that closure).
    // A better way is to pass the callback to gisLoaded.
    // I updated googleCalendarService to accept onTokenCallback.
    // But I can't easily re-init the token client.
    // Actually, google.accounts.oauth2.initTokenClient returns a client that we use.
    // I should pass the state setter to the service wrapper? Or just expose the client setter.
    // 
    // HACK: I'll rely on a global event or simpler prop passing if I could.
    // But since I control the service, let's just use the `gisLoaded` to pass the callback *once*.
    // If I re-run the effect, it re-inits the token client, which is fine.
  };

  const handleCalendarSignOut = () => {
    handleSignoutClick();
    setIsCalendarSignedIn(false);
  };

  const handleScheduleTodo = (todo) => {
    setTodoToSchedule(todo);
    setIsScheduleModalOpen(true);
  };

  const handleConfirmSchedule = async (eventDetails) => {
    try {
      await addEvent(eventDetails);
      // Ideally we show a success message or notification
      alert("Event scheduled successfully!");
    } catch (error) {
      console.error("Failed to schedule event", error);
      alert("Failed to schedule event. Please check your calendar connection.");
    }
  };

  useEffect(() => {
    if (!currentUser || isLoading) return undefined;

    const captureQuickTodo = async () => {
      const quickTodoText = quickTodoFromHash();
      if (!quickTodoText) return;

      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      try {
        const [quickTodo] = buildTodos([{ text: quickTodoText }]);
        await firestoreService.saveTodo(currentUser.uid, quickTodo);
        setTodos(previous => [...previous, quickTodo]);
        setQuickCaptureFailed(false);
        setQuickCaptureMessage(`Added “${quickTodoText}” to your todos.`);
        setView('todos');
      } catch (error) {
        console.error('Quick capture failed:', error);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#quickTodo=${encodeURIComponent(quickTodoText)}`);
        setQuickCaptureFailed(true);
        setQuickCaptureMessage('That todo could not be saved. Please try again.');
      }
    };

    window.addEventListener('hashchange', captureQuickTodo);
    captureQuickTodo();
    return () => window.removeEventListener('hashchange', captureQuickTodo);
  }, [currentUser, isLoading]);


  // -------------------------------------------------------------------------
  // Data Loading
  // -------------------------------------------------------------------------
  if (!currentUser) {
    return <Auth />;
  }

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

        const metadataMap = {};
        cloudMetadata.forEach(m => {
          metadataMap[m.id] = m;
        });

        if (cloudEntries.length === 0 && cloudTrash.length === 0) {
          const newEntry = { date: new Date().toISOString(), content: '' };
          await firestoreService.saveEntry(currentUser.uid, newEntry);
          cloudEntries = [newEntry];
        }

        setEntries(cloudEntries);
        setTrash(cloudTrash);
        setDayMetadata(metadataMap);

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

  // Group entries
  const groupedEntries = useMemo(() => {
    const groups = {};
    entries.forEach(entry => {
      const groupId = entry.groupId || new Date(entry.date).toDateString();
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(entry);
    });
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => new Date(b.date) - new Date(a.date));
    });
    return groups;
  }, [entries]);


  // Selected Date Management
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    if (!isLoading && !selectedDate) {
      const groupIds = Object.keys(groupedEntries).sort((a, b) => {
        const metaA = dayMetadata[a];
        const metaB = dayMetadata[b];

        if (metaA?.sortIndex !== undefined && metaB?.sortIndex !== undefined) {
          return metaA.sortIndex - metaB.sortIndex;
        }
        return new Date(b) - new Date(a);
      });

      if (groupIds.length > 0) {
        setSelectedDate(groupIds[0]);
      }
    }
  }, [isLoading, groupedEntries, selectedDate, dayMetadata]);

  useEffect(() => {
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
    const allMetadata = await firestoreService.getDayMetadata(currentUser.uid);
    setDayMetadata(Object.fromEntries(allMetadata.map(metadata => [metadata.id, metadata])));
  };

  const handleNotionImport = async (notionEntries) => {
    const count = await firestoreService.importNotionEntries(currentUser.uid, notionEntries);
    await refreshEntries();
    return count;
  };

  const handleSaveSettings = async (newKey, newPrompt, newEditPrompt, newClientId, newGoogleKey) => {
    setApiKey(newKey);
    setSystemPrompt(newPrompt);
    setEditPrompt(newEditPrompt);
    localStorage.setItem('gemini_api_key', newKey);
    localStorage.setItem('gemini_system_prompt', newPrompt);
    localStorage.setItem('gemini_edit_prompt', newEditPrompt);

    // Calendar Settings
    if (newClientId !== undefined) {
      setGoogleClientId(newClientId);
      localStorage.setItem('google_client_id', newClientId);
    }
    if (newGoogleKey !== undefined) {
      setGoogleApiKey(newGoogleKey);
      localStorage.setItem('google_api_key', newGoogleKey);
    }

    await firestoreService.saveUserSettings(currentUser.uid, {
      apiKey: newKey,
      systemPrompt: newPrompt,
      editPrompt: newEditPrompt
    });
  };

  const handleUpdateDayMetadata = async (groupId, newMetadata) => {
    setDayMetadata(prev => ({
      ...prev,
      [groupId]: { ...prev[groupId], ...newMetadata }
    }));
    await firestoreService.saveDayMetadata(currentUser.uid, groupId, newMetadata);
  };

  const saveEntry = async (date, content, groupId) => {
    setEntries(prev => prev.map(e => e.date === date ? { ...e, content, groupId } : e));
    await firestoreService.saveEntry(currentUser.uid, { date, content, groupId });
  };

  const createNewGroup = async () => {
    const newDate = new Date().toISOString();
    const newGroupId = newDate;
    const newEntry = { date: newDate, content: '', groupId: newGroupId };
    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();
    setSelectedDate(newGroupId);
    setView('diary');
  };

  const addToCurrentGroup = async () => {
    if (!selectedDate) return createNewGroup();
    const newEntry = {
      date: new Date().toISOString(),
      content: '',
      groupId: selectedDate
    };
    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();
  };

  const createCalendarScheduleNote = async (calendarDate, calendarEvents) => {
    const targetDate = new Date(calendarDate);
    const targetDay = targetDate.toDateString();
    const existingGroup = Object.entries(groupedEntries).find(([groupId, groupEntries]) => {
      const groupMatches = !Number.isNaN(new Date(groupId).getTime()) && new Date(groupId).toDateString() === targetDay;
      const entryMatches = groupEntries.some(entry => new Date(entry.date).toDateString() === targetDay);
      return groupMatches || entryMatches;
    });
    const groupId = existingGroup?.[0] || targetDay;

    const scheduleLines = calendarEvents.map(event => {
      const isAllDay = !event.start?.dateTime;
      const start = new Date(event.start?.dateTime || event.start?.date);
      const end = new Date(event.end?.dateTime || event.end?.date);
      const time = isAllDay
        ? 'All day'
        : `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const location = event.location ? ` — ${event.location}` : '';
      return `- **${time}** ${event.summary || '(No title)'}${location}`;
    });

    const generatedContent = await createCalendarDiaryNote(calendarDate, calendarEvents, apiKey);
    const content = generatedContent || `## Day from My Calendar\n\nI couldn't confidently piece these events into a narrative, so here is what else was scheduled:\n\n${scheduleLines.join('\n')}\n\n## Insight or Observation\n\n${createCalendarObservation(calendarEvents)}`;
    const now = new Date();
    targetDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    const newEntry = {
      date: targetDate.toISOString(),
      content,
      groupId,
      source: generatedContent ? 'google-calendar-ai' : 'google-calendar'
    };

    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();
    setSelectedDate(groupId);
    setView('diary');
    return { createdNewDay: !existingGroup };
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

    if (selectedDate === groupId) {
      setSelectedDate(null);
    }
  };

  // Todo Handlers
  const handleAddTodos = async (newTodos) => {
    const todosWithIds = buildTodos(newTodos);

    setTodos(prev => [...prev, ...todosWithIds]);
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

  const handleReorderTodos = async (updates) => {
    // updates: array of { id, changes: { sortIndex } }
    // Optimistic update
    setTodos(prev => {
      const newTodos = [...prev];
      updates.forEach(({ id, changes }) => {
        const idx = newTodos.findIndex(t => t.id === id);
        if (idx > -1) {
          newTodos[idx] = { ...newTodos[idx], ...changes };
        }
      });
      return newTodos;
    });

    // Batch update to firestore
    await firestoreService.updateTodosOrder(currentUser.uid, updates);
  };

  const currentDayEntries = groupedEntries[selectedDate] || [];

  // Gemini Handlers
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
      const suggestion = await askGemini(prompt, [], apiKey, systemPrompt);
      setGlobalGemini({ loading: false, suggestion, isWaitingForPrompt: false });

      if (customPrompt) {
        setGlobalChatHistory([
          { role: 'user', content: customPrompt },
          { role: 'model', content: suggestion.content }
        ]);
      } else {
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

  const handleExtractTodosPage = async () => {
    if (currentDayEntries.length === 0) return;
    setGlobalGemini({ loading: false, suggestion: null, isWaitingForPrompt: false });
    setGlobalGemini(prev => ({ ...prev, loading: true }));

    const aggregatedContent = currentDayEntries
      .map(e => `[Entry Time: ${new Date(e.date).toLocaleTimeString()}]\n${e.content}`)
      .join('\n\n---\n\n');

    try {
      const todos = await extractTodos(aggregatedContent, apiKey);
      if (todos && todos.length > 0) {
        setGlobalGemini({
          loading: false,
          isWaitingForPrompt: false,
          suggestion: {
            type: 'todos',
            content: '',
            todos: todos
          }
        });
      } else {
        setGlobalGemini({
          loading: false,
          isWaitingForPrompt: false,
          suggestion: {
            type: 'text',
            content: "I couldn't find any clear tasks in today's entries."
          }
        });
      }
    } catch (error) {
      console.error("Error extracting page todos:", error);
      setGlobalGemini({
        loading: false,
        isWaitingForPrompt: false,
        suggestion: {
          type: 'text',
          content: "Sorry, I encountered an error while looking for tasks."
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
    if (globalChatHistory.length > 0) {
      textToSave = `# Gemini Analysis\n\n`;
      globalChatHistory.forEach(msg => {
        if (msg.role === 'user' && msg.content.startsWith("Here are my diary entries")) {
          return;
        }
        if (msg.role === 'user') {
          textToSave += `> **User:** ${msg.content}\n\n`;
        } else {
          textToSave += `> **Gemini:** ${msg.content}\n\n`;
        }
      });
    } else {
      textToSave = `> **Gemini:** ${globalGemini.suggestion.content}`;
    }

    const newEntry = {
      date: new Date().toISOString(),
      content: textToSave,
      groupId: selectedDate,
      type: 'analysis'
    };

    await firestoreService.saveEntry(currentUser.uid, newEntry);
    await refreshEntries();
    setGlobalGemini({ loading: false, suggestion: null });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row h-screen overflow-hidden">
      {quickCaptureMessage && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md ${quickCaptureFailed ? 'bg-red-600' : 'bg-emerald-600'} text-white px-4 py-3 rounded-xl shadow-xl flex items-start gap-3`}>
          <CheckCircle2 size={20} className="mt-0.5 flex-shrink-0" />
          <span className="text-sm font-medium flex-1">{quickCaptureMessage}</span>
          <button onClick={() => setQuickCaptureMessage('')} className="text-white/80 hover:text-white" aria-label="Dismiss confirmation">
            <X size={18} />
          </button>
        </div>
      )}
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-20 flex-shrink-0">
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
        dayMetadata={dayMetadata}
        onUpdateDayMetadata={handleUpdateDayMetadata}
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date);
          setView('diary');
          setGlobalGemini({ loading: false, suggestion: null });
        }}
        onAddEntry={createNewGroup}
        onDeleteDay={deleteGroup}
        currentView={view}
        onViewTrash={() => setView('trash')}
        onViewTodos={() => setView('todos')}
        onLogout={logout}
        userEmail={currentUser.email}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onSettings={() => setIsSettingsOpen(true)}
        todos={todos}
        onToggleTodo={handleToggleTodo}
        onDeleteTodo={handleDeleteTodo}
      />

      <main className="flex-1 md:ml-64 flex overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-12 lg:p-16">
          <div className="max-w-3xl mx-auto">
            {view === 'todos' ? (
              <div className="pb-20">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 md:mb-8 border-b border-slate-200 pb-4 flex items-center gap-3">
                  <ListTodo className="text-indigo-600" size={32} />
                  <span>Todos</span>
                  <span className="text-sm font-normal text-slate-500 bg-slate-100 px-3 py-1 rounded-full">{todos.filter(t => !t.completed).length} active</span>
                </h1>
                <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
                  <TodoSection
                    todos={todos}
                    onToggle={handleToggleTodo}
                    onDelete={handleDeleteTodo}
                    onSchedule={handleScheduleTodo}
                    onReorder={handleReorderTodos}
                    onAdd={(text) => handleAddTodos([{ text, priority: 'medium', completed: false, sortIndex: Date.now() }])}
                    isPage={true}
                  />
                </div>
              </div>
            ) : view === 'trash' ? (
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
                <div className="pb-20">
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
                          showDateHeader={false}
                          apiKey={apiKey}
                          systemPrompt={systemPrompt}
                          editPrompt={editPrompt}
                          onAddTodos={handleAddTodos}
                        />
                      ))}

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
                          isAnalysis={true}
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
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={handleAskPage}
                          className="flex-1 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl transition-colors font-medium border border-indigo-200 border-dashed"
                        >
                          <Sparkles size={18} />
                          <span>Ask Gemini about today</span>
                        </button>
                        <button
                          onClick={handleExtractTodosPage}
                          className="flex-shrink-0 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 px-6 rounded-xl transition-colors font-medium border border-indigo-200 border-dashed"
                        >
                          <ListTodo size={18} />
                          <span>Create Todos from Today</span>
                        </button>
                      </div>
                    ) : (
                      <GeminiPanel
                        isLoading={globalGemini.loading}
                        suggestion={globalGemini.suggestion}
                        isWaitingForPrompt={globalGemini.isWaitingForPrompt}
                        onAsk={handleConfirmAskPage}
                        onClose={() => setGlobalGemini({ loading: false, suggestion: null, isWaitingForPrompt: false })}
                        onReply={handleGlobalReply}
                        onAddToNote={handleSaveGlobalAnalysis}
                        onAddTodos={handleAddTodos}
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
        </div>

        {/* Calendar Sidebar - Right Column */}
        {/* Only show on large screens or via toggle (future) for now stick to XL */}
        <div className="w-[350px] border-l border-slate-200 bg-white hidden xl:flex flex-col">
          <CalendarPanel
            isSignedIn={isCalendarSignedIn}
            onSignIn={handleCalendarSignIn}
            onSignOut={handleCalendarSignOut}
            isConfigured={isCalendarConfigured}
            onCreateNote={createCalendarScheduleNote}
            onAddEvent={(date) => {
              setTodoToSchedule(null); // Clear todo context
              // We need a state for the specific date clicked in calendar
              // Reuse 'selectedDate' prop of modal? Or add a new one?
              // The Modal currently takes 'initialDate'.
              // Let's add a state 'calendarActionDate'
              setCalendarActionDate(date);
              setIsScheduleModalOpen(true);
            }}
          />
        </div>
      </main>

      {isSettingsOpen && (
        <SettingsModal
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
          initialApiKey={apiKey}
          initialSystemPrompt={systemPrompt}
          initialEditPrompt={editPrompt}
          initialGoogleClientId={googleClientId}
          initialGoogleApiKey={googleApiKey}
          onNotionImport={handleNotionImport}
          entries={entries}
          dayMetadata={dayMetadata}
        />
      )}

      <ScheduleTodoModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setCalendarActionDate(null);
        }}
        onSchedule={handleConfirmSchedule}
        todoTitle={todoToSchedule ? todoToSchedule.text : ''}
        initialDate={calendarActionDate || selectedDate} // prioritize calendar action, fallback to diary date
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
