import React, { useState, useEffect, useMemo } from 'react';
import DiaryEntry from './components/DiaryEntry';
import Sidebar from './components/Sidebar';

function App() {
  const [entries, setEntries] = useState(() => {
    const saved = localStorage.getItem('diary_entries');
    return saved ? JSON.parse(saved) : [{ date: new Date().toISOString(), content: '' }];
  });

  const [trash, setTrash] = useState(() => {
    const saved = localStorage.getItem('diary_trash');
    return saved ? JSON.parse(saved) : [];
  });

  const [view, setView] = useState('diary'); // 'diary' | 'trash'

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
  const [selectedDate, setSelectedDate] = useState(() => {
    const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
    return dates[0];
  });

  useEffect(() => {
    // If selectedDate is not in groups (e.g. all deleted), reset to first available
    if (view === 'diary') {
      if (selectedDate && !groupedEntries[selectedDate]) {
        const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(dates[0]);
      } else if (!selectedDate && Object.keys(groupedEntries).length > 0) {
        const dates = Object.keys(groupedEntries).sort((a, b) => new Date(b) - new Date(a));
        setSelectedDate(dates[0]);
      }
    }
  }, [groupedEntries, selectedDate, view]);

  const saveEntry = (date, content) => {
    setEntries(prev => {
      const newEntries = prev.map(entry =>
        entry.date === date ? { ...entry, content } : entry
      );
      localStorage.setItem('diary_entries', JSON.stringify(newEntries));
      return newEntries;
    });
  };

  const addEntry = () => {
    const newEntry = { date: new Date().toISOString(), content: '' };
    setEntries(prev => {
      const newEntries = [newEntry, ...prev];
      localStorage.setItem('diary_entries', JSON.stringify(newEntries));
      return newEntries;
    });
    // Select the day of the new entry (which is today)
    setSelectedDate(new Date(newEntry.date).toDateString());
    setView('diary');
  };

  const deleteEntry = (entryDate) => {
    setEntries(prev => {
      const entryToDelete = prev.find(e => e.date === entryDate);
      if (entryToDelete && entryToDelete.content.trim()) {
        // Only add to trash if it has content
        setTrash(prevTrash => {
          const newTrash = [entryToDelete, ...prevTrash];
          localStorage.setItem('diary_trash', JSON.stringify(newTrash));
          return newTrash;
        });
      }

      const newEntries = prev.filter(entry => entry.date !== entryDate);
      localStorage.setItem('diary_entries', JSON.stringify(newEntries));
      return newEntries;
    });
  };

  const deleteDay = (dateStr) => {
    setEntries(prev => {
      const entriesToDelete = prev.filter(entry => new Date(entry.date).toDateString() === dateStr);
      const entriesWithContent = entriesToDelete.filter(e => e.content.trim());

      if (entriesWithContent.length > 0) {
        setTrash(prevTrash => {
          const newTrash = [...entriesWithContent, ...prevTrash];
          localStorage.setItem('diary_trash', JSON.stringify(newTrash));
          return newTrash;
        });
      }

      const newEntries = prev.filter(entry => new Date(entry.date).toDateString() !== dateStr);
      localStorage.setItem('diary_entries', JSON.stringify(newEntries));
      return newEntries;
    });

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

export default App;
