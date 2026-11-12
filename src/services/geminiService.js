import { callLlm, callLlmLong } from "./llmGateway";
import { filterEventsForAi } from "../utils/aiCalendarPrivacy";

export const DEFAULT_SYSTEM_PROMPT = `
You are a supportive, insightful "Thinking Partner" for a user writing in their diary.
Your goal is to help the user reflect deeper, organize their thoughts, or expand on their ideas.
You should be empathetic, non-judgmental, and concise.

Analyze the user's diary entry and provide a response in valid JSON format.
Do NOT use Markdown code blocks for the JSON. Just output the raw JSON.

The JSON object must have the following structure:
{
  "type": "question" | "suggestion" | "expansion",
  "content": "Your response text here. Be conversational and helpful.",
  "tool": { // Optional. Only include if you have a concrete action to propose.
    "label": "Button label (e.g., 'Add Heading', 'Insert List')",
    "action": "insert" | "heading",
    "value": "The text to insert into the diary."
  }
}

Examples of behaviors:
1. If the user is vague, ask a probing question ("type": "question").
2. If the user is unstructured, suggest a heading or structure ("type": "suggestion", with a tool).
3. If the user is stuck, offer to expand or list pros/cons ("type": "expansion", with a tool).
`;

export const DEFAULT_EDIT_PROMPT = `
You are a helpful writing assistant.
The user has selected the following text: "{{selection}}"

The user wants you to: "{{instruction}}"

Return ONLY the new text that should replace the selection. 
Do not add any explanations, quotes, or markdown unless requested.
If the user asks a question instead of an edit, answer the question but prefix it with "[ANSWER]: ".
`;

const CALENDAR_USAGE_GUIDANCE = `The user often uses the calendar as a flexible todo list to shape the day. Multiple items may intentionally share a time window because they are tasks to work through during that block. Do not treat overlap alone as double-booking, a conflict, or a problem unless the event details clearly indicate simultaneous fixed commitments.`;

export const formatCalendarContext = (calendarContext) => {
    if (!calendarContext || !Array.isArray(calendarContext.events)) return '';
    // Defence in depth: never include events from calendars blocked from AI.
    const allowedEvents = filterEventsForAi(calendarContext.events);

    const contextDate = new Date(calendarContext.date);
    const dateLabel = Number.isNaN(contextDate.getTime())
        ? 'the visible day'
        : contextDate.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

    const eventLines = allowedEvents.map((event) => {
        const isAllDay = !event.start?.dateTime;
        const start = new Date(event.start?.dateTime || event.start?.date);
        const end = new Date(event.end?.dateTime || event.end?.date);
        const time = isAllDay
            ? 'All day'
            : `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const location = event.location ? `; location: ${event.location}` : '';
        const calendarName = event._calendarName ? ` [${event._calendarName}]` : '';
        return `- ${time}: ${event.summary || '(No title)'}${calendarName}${location}`;
    });

    return [
        `Visible Google Calendar schedule for ${dateLabel}:`,
        'Treat these as scheduled plans, not proof that they happened.',
        CALENDAR_USAGE_GUIDANCE,
        eventLines.length ? eventLines.join('\n') : '- No events scheduled.',
    ].join('\n');
};

// The gateway owns the default prompts. A system prompt is only sent when it was customised
// in Settings, so the gateway can log it as a custom prompt version.
const customOrUndefined = (prompt, defaultPrompt) => {
    const trimmed = (prompt || '').trim();
    return trimmed && trimmed !== defaultPrompt.trim() ? prompt : undefined;
};

export const askGemini = async (text, history = [], systemPrompt) => {
    try {
        return await callLlm('chat', {
            text,
            history: history.map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', content: String(msg.content ?? '') })),
            systemPrompt: customOrUndefined(systemPrompt, DEFAULT_SYSTEM_PROMPT),
        });
    } catch (error) {
        console.error("Error calling the AI gateway:", error);
        return {
            type: 'question',
            content: "I'm having trouble thinking right now. Please try again in a moment.",
        };
    }
};

export const editSelection = async (selection, instruction, editPrompt) => {
    try {
        const result = await callLlm('edit', {
            selection,
            instruction,
            editPrompt: customOrUndefined(editPrompt, DEFAULT_EDIT_PROMPT),
        });
        return result.trim();
    } catch (error) {
        console.error("Error calling the AI gateway for edit:", error);
        return selection;
    }
};

export const createCalendarObservation = (events) => {
    const timedEvents = (events || [])
        .filter(event => event.start?.dateTime && event.end?.dateTime)
        .map(event => ({
            title: event.summary || '(No title)',
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime)
        }))
        .filter(event => !Number.isNaN(event.start.getTime()) && !Number.isNaN(event.end.getTime()))
        .sort((a, b) => a.start - b.start);

    let latestEnd = null;
    const overlaps = timedEvents.filter(event => {
        const overlapsPrevious = latestEnd && event.start < latestEnd;
        if (!latestEnd || event.end > latestEnd) latestEnd = event.end;
        return overlapsPrevious;
    });
    if (overlaps.length) {
        return `Some scheduled items share the same time window, consistent with using the calendar as a flexible todo list: they can be read as tasks intended for that broader block rather than a scheduling conflict.`;
    }

    const longest = timedEvents.reduce((current, event) => {
        const duration = event.end - event.start;
        return !current || duration > current.duration ? { ...event, duration } : current;
    }, null);
    if (longest?.duration >= 2 * 60 * 60 * 1000) {
        const hours = longest.duration / (60 * 60 * 1000);
        return `“${longest.title}” was the largest block in the calendar at ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours, making it the day’s main scheduled time commitment.`;
    }

    if (timedEvents.length >= 6) {
        const span = (timedEvents[timedEvents.length - 1].end - timedEvents[0].start) / (60 * 60 * 1000);
        return `The calendar was fairly structured, with ${timedEvents.length} timed items spread across roughly ${Math.max(1, Math.round(span))} hours.`;
    }

    return `The calendar contained ${events?.length || 0} scheduled item${events?.length === 1 ? '' : 's'}, leaving a relatively simple outline of the day rather than a tightly packed plan.`;
};

export const createCalendarDayShape = (events) => {
    const timedEvents = (events || [])
        .filter(event => event.start?.dateTime && event.end?.dateTime)
        .map(event => ({
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime)
        }))
        .filter(event => !Number.isNaN(event.start.getTime()) && !Number.isNaN(event.end.getTime()) && event.end > event.start)
        .sort((a, b) => a.start - b.start);

    if (!timedEvents.length) {
        return `The calendar frames this as ${events?.length ? 'an open-ended day organised around all-day commitments' : 'an unstructured day with no recorded commitments'}.`;
    }

    const merged = [];
    timedEvents.forEach(event => {
        const previous = merged[merged.length - 1];
        if (previous && event.start <= previous.end) {
            if (event.end > previous.end) previous.end = event.end;
        } else {
            merged.push({ ...event });
        }
    });

    const span = timedEvents[timedEvents.length - 1].end - timedEvents[0].start;
    const occupied = merged.reduce((total, event) => total + (event.end - event.start), 0);
    const occupancy = span > 0 ? occupied / span : 1;
    const longestBlock = Math.max(...timedEvents.map(event => event.end - event.start));
    const gaps = merged.slice(1).map((event, index) => event.start - merged[index].end);
    const longestGap = gaps.length ? Math.max(...gaps) : 0;

    if (timedEvents.length >= 7 || (timedEvents.length >= 4 && occupancy >= 0.75)) {
        return 'The calendar frames this as a tightly structured, task-heavy day, with much of the available time already spoken for and relatively little room between commitments.';
    }
    if (longestBlock >= 3 * 60 * 60 * 1000) {
        return 'The calendar frames this as a focus-led day, built around one substantial commitment with the remaining items arranged around it.';
    }
    if (longestGap >= 3 * 60 * 60 * 1000) {
        return 'The calendar frames this as a split-paced day, with distinct periods of activity separated by a meaningful stretch of open time.';
    }
    if (timedEvents.length <= 3) {
        return 'The calendar frames this as a lightly structured day, with a few clear anchors and plenty of time left undefined.';
    }
    return 'The calendar frames this as a moderately structured, mixed-paced day: organised enough to give it direction without every part being tightly scheduled.';
};

export const createCalendarDiaryNote = async (calendarDate, calendarEvents) => {
    // Defence in depth: never send events from calendars blocked from AI.
    const events = filterEventsForAi(calendarEvents);
    if (!events.length) return null;

    const eventDetails = events.map(event => {
        const isAllDay = !event.start?.dateTime;
        const start = new Date(event.start?.dateTime || event.start?.date);
        const end = new Date(event.end?.dateTime || event.end?.date);
        const time = isAllDay
            ? 'All day'
            : `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        return {
            time,
            title: event.summary || '(No title)',
            location: event.location || null,
            description: event.description?.slice(0, 1000) || null
        };
    });

    const dateLabel = new Date(calendarDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    try {
        let note = (await callLlm('calendarNote', { dateLabel, events: eventDetails })).trim();
        if (note && !/^##\s+Shape of the Day/im.test(note)) {
            const insightIndex = note.search(/^##\s+(?:Insight|Observation)/im);
            const shapeSection = `## Shape of the Day\n\n${createCalendarDayShape(events)}`;
            note = insightIndex >= 0
                ? `${note.slice(0, insightIndex).trim()}\n\n${shapeSection}\n\n${note.slice(insightIndex).trim()}`
                : `${note}\n\n${shapeSection}`;
        }
        if (note && !/^##\s+(?:Insight|Observation)/im.test(note)) {
            note += `\n\n## Insight or Observation\n\n${createCalendarObservation(events)}`;
        }
        return note || null;
    } catch (error) {
        console.error('Error creating calendar diary note:', error);
        return null;
    }
};

export const extractTodos = async (text) => {
    try {
        return await callLlm('extractTodos', { text });
    } catch (error) {
        console.error("Error extracting todos:", error);
        return [];
    }
};

// "Analyze my week": input from weekReviewInput (utils/weeks.js). Returns Markdown. Errors are
// thrown so the week view can say what went wrong (for example the daily AI limit).
export const analyzeWeek = async (input) => callLlmLong('weekReview', input);
