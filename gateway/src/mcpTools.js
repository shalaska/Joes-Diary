// Tools only the MCP server offers, on top of the Ask agent's tools. The outside app's own model
// does the thinking (a week's analysis, a nudge to write), so none of these call Gemini.
//
// - list_todos (with ids), read_week, diary_status: read permission.
// - add_note, add_todo, complete_todo, delete_todo, restore_todo, save_week_review: the separate
//   "change" permission. delete_todo moves the to-do to users/{uid}/todoTrash for TRASH_DAYS, where
//   the app can restore it. add_note only adds a new note to a day. No tool edits or deletes what
//   the user wrote in the diary. Everything Claude adds carries source: 'claude', and the app marks
//   it "by Claude".
import { dayOf } from './agent.js';

export const TIME_ZONE = 'Europe/London';
// Changes Claude may make in a day, so a runaway loop cannot rewrite the to-do list.
export const MAX_CHANGES_PER_DAY = 30;
export const TRASH_DAYS = 7;
const WEEK_CHARS = 60000;
const TODO_CHARS = 300;
const REVIEW_CHARS = 8000;
const NOTE_CHARS = 4000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['high', 'medium', 'low'];
const DAY_MS = 864e5;

const stripMarkup = (text) => String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();
const fence = (tag, day, text) => `<${tag} day="${day}">\n${text}\n</${tag}>`;

// Calendar arithmetic on YYYY-MM-DD strings, in UTC so the server's own zone never matters.
const toUtc = (day) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day, n) => fromUtc(toUtc(day) + n * DAY_MS);
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
export const mondayOf = (day) => addDays(day, -((new Date(toUtc(day)).getUTCDay() + 6) % 7));
const weekdayName = (day) => new Date(toUtc(day)).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

// The user's own today, not the server's.
export const todayIn = (ms, timeZone = TIME_ZONE) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// "9–15 Nov 2026", as the app's week view writes it, so a review saved here looks the same.
export const weekLabel = (monday) => {
    const sunday = addDays(monday, 6);
    const dayMonth = (d) => new Date(toUtc(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const year = (d) => d.slice(0, 4);
    if (year(monday) !== year(sunday)) return `${dayMonth(monday)} ${year(monday)} – ${dayMonth(sunday)} ${year(sunday)}`;
    if (monday.slice(5, 7) !== sunday.slice(5, 7)) return `${dayMonth(monday)} – ${dayMonth(sunday)} ${year(sunday)}`;
    return `${Number(monday.slice(8))}–${dayMonth(sunday)} ${year(sunday)}`;
};

// The app's groupId for a day: Date#toDateString of local midnight, e.g. "Sat Nov 14 2026".
const groupIdOf = (day) => new Date(toUtc(day)).toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}).*$/, '$1 $3 $2 $4');

const isReview = (entry) => entry.type === 'analysis';

// Claude often starts a review with its own title; the diary adds "# Week of ...", so drop it.
const withoutTitle = (text) => text.replace(/^#{1,6} [^\n]*\n+/, '').trim();

/**
 * store: { entries(), todos(), addTodo(todo) -> id, updateTodo(id, fields), deleteTodo(id),
 *   saveEntry(entry) -> id, takeChange(limit) -> false once today's limit is reached }
 */
export const createMcpTools = ({ store, now = () => Date.now(), timeZone = TIME_ZONE }) => {
    const today = () => todayIn(now(), timeZone);
    // A day the app started with "New day" has a timestamp groupId: its day is the user's, not UTC's.
    const localDay = (e) => (/^\d{4}-\d{2}-\d{2}T/.test(String(e.groupId)) && !Number.isNaN(Date.parse(e.groupId))
        ? todayIn(Date.parse(e.groupId), timeZone)
        : dayOf(e));
    let cache = null;
    const entries = async () => {
        if (!cache) cache = (await store.entries()).map(e => ({ ...e, day: localDay(e) }));
        return cache;
    };

    // The day's own groupId if the diary already has that day (the app makes some groupIds from a
    // timestamp, so building one from the date would split the day in two), else a new one.
    const groupFor = async (day) => {
        const existing = (await entries()).find(e => e.day === day && !isReview(e) && e.groupId);
        return existing ? existing.groupId : groupIdOf(day);
    };

    const weekOf = (value) => {
        const day = value === undefined || value === '' ? today() : String(value);
        if (!ISO_DAY.test(day) || Number.isNaN(toUtc(day))) return null;
        return mondayOf(day);
    };

    const savedReview = (all, monday) => {
        const heading = `# Week of ${weekLabel(monday)}`;
        return all
            .filter(e => isReview(e) && (e.weekKey === monday || (!e.weekKey && String(e.content || '').startsWith(heading))))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
    };

    const read = {
        list_todos: {
            description: `The to-do list with priorities and ids (the ids are for complete_todo, delete_todo and restore_todo). status "deleted" lists to-dos Claude deleted in the last ${TRASH_DAYS} days.`,
            parameters: {
                type: 'OBJECT',
                properties: { status: { type: 'STRING', enum: ['open', 'done', 'all', 'deleted'], description: 'Default open' } },
            },
            run: async ({ status = 'open' }) => {
                if (status === 'deleted') {
                    const trashed = (await store.trashedTodos()).filter(t => t.expiresAt > now());
                    return { todos: trashed.map(t => ({ id: t.id, text: `<todo>${stripMarkup(t.todo?.text)}</todo>`, deletedAt: t.deletedAt })) };
                }
                const todos = (await store.todos())
                    .filter(t => status === 'all' || (status === 'done' ? t.completed : !t.completed))
                    .sort((a, b) => (b.sortIndex || 0) - (a.sortIndex || 0))
                    .slice(0, 100);
                return {
                    todos: todos.map(t => ({
                        id: t.id,
                        text: `<todo>${stripMarkup(t.text)}</todo>`,
                        priority: t.priority || null,
                        done: Boolean(t.completed),
                        ...(t.source === 'claude' ? { addedBy: 'claude' } : {}),
                    })),
                };
            },
        },
        read_week: {
            description: 'Everything written in one Monday-to-Sunday week, day by day, plus the week review saved for it, if any. Use it to review or analyse a week. Notes in the user\'s words come back in <entry> tags, a saved review in <review> tags.',
            parameters: {
                type: 'OBJECT',
                properties: { week_of: { type: 'STRING', description: 'Any day in the week, YYYY-MM-DD. Default: this week.' } },
            },
            run: async ({ week_of: weekArg }) => {
                const monday = weekOf(weekArg);
                if (!monday) return { error: 'week_of must be a day, YYYY-MM-DD' };
                const sunday = addDays(monday, 6);
                const all = await entries();
                const notes = all.filter(e => !isReview(e) && e.day >= monday && e.day <= sunday);
                let budget = WEEK_CHARS;
                const days = [];
                for (let i = 0; i < 7; i++) {
                    const day = addDays(monday, i);
                    const text = notes.filter(e => e.day === day)
                        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                        .map(e => stripMarkup(e.content)).filter(Boolean).join('\n\n');
                    if (!text) continue;
                    const cut = text.slice(0, Math.max(0, budget));
                    budget -= cut.length;
                    days.push({ day, weekday: weekdayName(day), text: fence('entry', day, cut), truncated: cut.length < text.length || undefined });
                }
                const review = savedReview(all, monday);
                return {
                    week: { from: monday, to: sunday, label: weekLabel(monday) },
                    days,
                    daysWithoutNotes: Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(d => d <= today() && !days.some(x => x.day === d)),
                    savedReview: review ? fence('review', review.day, stripMarkup(review.content)) : null,
                };
            },
        },
        diary_status: {
            description: 'A quick check of the diary: today\'s date for the user, when they last wrote and how many days ago, how many days they wrote in the last 7, open and high-priority to-dos, and whether last week has a review. No diary text.',
            parameters: { type: 'OBJECT', properties: {} },
            run: async () => {
                const day = today();
                const all = await entries();
                const writtenDays = [...new Set(all.filter(e => !isReview(e) && stripMarkup(e.content)).map(e => e.day))].filter(d => d <= day).sort();
                const last = writtenDays[writtenDays.length - 1] || null;
                const todos = (await store.todos()).filter(t => !t.completed);
                const lastMonday = addDays(mondayOf(day), -7);
                return {
                    today: day,
                    weekday: weekdayName(day),
                    lastEntryDay: last,
                    daysSinceLastEntry: last ? daysBetween(last, day) : null,
                    daysWrittenLast7: writtenDays.filter(d => d > addDays(day, -7)).length,
                    openTodos: todos.length,
                    highPriorityTodos: todos.filter(t => t.priority === 'high').length,
                    lastWeek: { from: lastMonday, reviewed: Boolean(savedReview(all, lastMonday)) },
                };
            },
        },
    };

    const overLimit = { error: `Claude has already made ${MAX_CHANGES_PER_DAY} changes to the diary today. Ask the user to make more themselves.` };
    const todoById = async (id) => (await store.todos()).find(t => t.id === String(id || '')) || null;

    const change = {
        add_note: {
            description: 'Add a new note to a day of the diary, today unless the user names another day. It goes into that day if the diary has it already, or starts the day if not, and shows as written by Claude. Use it when the user asks you to write something down or add a note. It never changes or replaces a note the user wrote.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    text: { type: 'STRING', description: 'The note, in Markdown, in the user\'s voice if they asked you to write it for them' },
                    day: { type: 'STRING', description: 'YYYY-MM-DD. Default: today' },
                },
                required: ['text'],
            },
            run: async ({ text, day: dayArg }) => {
                const day = dayArg === undefined || dayArg === '' ? today() : String(dayArg);
                if (!ISO_DAY.test(day) || Number.isNaN(toUtc(day))) return { error: 'day must be YYYY-MM-DD' };
                if (day > today()) return { error: 'That day has not happened yet.' };
                const clean = String(text || '').trim();
                if (!clean || clean.length > NOTE_CHARS) return { error: `text must be 1 to ${NOTE_CHARS} characters` };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const groupId = await groupFor(day);
                const newDay = !(await entries()).some(e => e.groupId === groupId);
                const id = await store.saveEntry({ date: new Date(now()).toISOString(), content: clean, groupId, source: 'claude' });
                cache = null;
                return { added: true, id, day, note: newDay ? 'Started a new day in the diary with this note, marked as written by Claude.' : 'Added to that day in the diary, marked as written by Claude.' };
            },
        },
        add_todo: {
            description: 'Add a new to-do to the user\'s list. It shows as added by Claude. Use it when the user asks for a to-do.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    text: { type: 'STRING', description: 'The to-do, short and starting with a verb' },
                    priority: { type: 'STRING', enum: PRIORITIES, description: 'Default medium' },
                },
                required: ['text'],
            },
            run: async ({ text, priority = 'medium' }) => {
                const clean = stripMarkup(text);
                if (!clean || clean.length > TODO_CHARS) return { error: `text must be 1 to ${TODO_CHARS} characters` };
                if (!PRIORITIES.includes(priority)) return { error: 'priority must be high, medium or low' };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const id = await store.addTodo({ text: clean, priority, completed: false, created: new Date(now()).toISOString(), sortIndex: now(), source: 'claude' });
                return { added: true, id, note: 'The to-do is on the user\'s list now, marked as added by Claude.' };
            },
        },
        complete_todo: {
            description: 'Tick off a to-do, or untick it with done=false. Take the id from list_todos. Use it when the user says a to-do is done.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    id: { type: 'STRING', description: 'The to-do\'s id from list_todos' },
                    done: { type: 'STRING', enum: ['true', 'false'], description: 'Default true' },
                },
                required: ['id'],
            },
            run: async ({ id, done = 'true' }) => {
                const todo = await todoById(id);
                if (!todo) return { error: 'No to-do has that id. Call list_todos for the ids.' };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const completed = done !== 'false';
                await store.updateTodo(todo.id, { completed });
                return { done: completed, text: `<todo>${stripMarkup(todo.text)}</todo>` };
            },
        },
        delete_todo: {
            description: `Delete a to-do. Take the id from list_todos. Use it only when the user asks to remove a to-do; if they say it is done, use complete_todo instead. The user can restore it for ${TRASH_DAYS} days.`,
            parameters: {
                type: 'OBJECT',
                properties: { id: { type: 'STRING', description: 'The to-do\'s id from list_todos' } },
                required: ['id'],
            },
            run: async ({ id }) => {
                const todo = await todoById(id);
                if (!todo) return { error: 'No to-do has that id. Call list_todos for the ids.' };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const deletedAt = new Date(now()).toISOString();
                await store.trashTodo(todo, { deletedAt, deletedBy: 'claude', expiresAt: now() + TRASH_DAYS * DAY_MS });
                return { deleted: true, text: `<todo>${stripMarkup(todo.text)}</todo>`, note: `It can be restored for ${TRASH_DAYS} days, in the diary's Settings or with restore_todo.` };
            },
        },
        restore_todo: {
            description: `Bring back a to-do Claude deleted in the last ${TRASH_DAYS} days. Take the id from list_todos with status "deleted".`,
            parameters: {
                type: 'OBJECT',
                properties: { id: { type: 'STRING', description: 'The deleted to-do\'s id' } },
                required: ['id'],
            },
            run: async ({ id }) => {
                const trashed = (await store.trashedTodos()).find(t => t.id === String(id || '') && t.expiresAt > now());
                if (!trashed) return { error: 'No recently deleted to-do has that id. Call list_todos with status "deleted".' };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const todo = await store.restoreTodo(trashed.id);
                return { restored: Boolean(todo), text: `<todo>${stripMarkup(todo?.text)}</todo>` };
            },
        },
        save_week_review: {
            description: 'Save a review of one week into the diary\'s week view (not onto a day), marked as written by Claude. Use it when the user asks to save a review. Do not start with a title: the diary adds "Week of ...". It never changes what the user wrote; the newest review of a week is the one shown.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    week_of: { type: 'STRING', description: 'Any day in the week, YYYY-MM-DD' },
                    review: { type: 'STRING', description: 'The review, in Markdown, addressed to the user' },
                },
                required: ['week_of', 'review'],
            },
            run: async ({ week_of: weekArg, review }) => {
                const monday = weekOf(weekArg);
                if (!monday) return { error: 'week_of must be a day, YYYY-MM-DD' };
                const text = withoutTitle(String(review || '').trim());
                if (!text || text.length > REVIEW_CHARS) return { error: `review must be 1 to ${REVIEW_CHARS} characters` };
                if (monday > today()) return { error: 'That week has not started yet.' };
                if (!(await store.takeChange(MAX_CHANGES_PER_DAY))) return overLimit;
                const sunday = addDays(monday, 6);
                // Like the app: the review sits on the latest day of the week that has notes.
                const noteDays = (await entries()).filter(e => !isReview(e) && e.day >= monday && e.day <= sunday).map(e => e.day).sort();
                const day = noteDays[noteDays.length - 1] || (sunday < today() ? sunday : today());
                const id = await store.saveEntry({
                    date: new Date(now()).toISOString(),
                    content: `# Week of ${weekLabel(monday)}\n\n${text}`,
                    groupId: await groupFor(day),
                    type: 'analysis',
                    weekKey: monday,
                    source: 'claude',
                });
                cache = null;
                return { saved: true, id, day, note: 'The review is in the diary now, on the week view, marked as written by Claude.' };
            },
        },
    };

    return { read, change };
};
