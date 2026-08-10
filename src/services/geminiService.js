import { GoogleGenerativeAI } from "@google/generative-ai";

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

const getModel = (apiKey) => {
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: "gemini-flash-latest" });
};

const CALENDAR_USAGE_GUIDANCE = `The user often uses the calendar as a flexible todo list to shape the day. Multiple items may intentionally share a time window because they are tasks to work through during that block. Do not treat overlap alone as double-booking, a conflict, or a problem unless the event details clearly indicate simultaneous fixed commitments.`;

export const formatCalendarContext = (calendarContext) => {
    if (!calendarContext || !Array.isArray(calendarContext.events)) return '';

    const contextDate = new Date(calendarContext.date);
    const dateLabel = Number.isNaN(contextDate.getTime())
        ? 'the visible day'
        : contextDate.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

    const eventLines = calendarContext.events.map((event) => {
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

export const askGemini = async (text, history = [], apiKey, systemPrompt) => {
    if (!apiKey) {
        console.warn("Gemini API Key is missing.");
        return {
            type: 'suggestion',
            content: "I can't connect to my brain right now because the API key is missing. Please add your API Key in Settings.",
        };
    }

    try {
        const model = getModel(apiKey);
        const activeSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

        let promptParts = [activeSystemPrompt];

        // Add history to context
        if (history.length > 0) {
            promptParts.push("Previous conversation:");
            history.forEach(msg => {
                promptParts.push(`${msg.role === 'user' ? 'User' : 'You'}: ${msg.content}`);
            });
        }

        promptParts.push(`User's current input:\n"${text}"`);

        const result = await model.generateContent(promptParts);

        const response = await result.response;
        const textResponse = response.text();

        // Clean up potential markdown formatting if the model adds it despite instructions
        const cleanJson = textResponse.replace(/```json\n?|\n?```/g, '').trim();

        return JSON.parse(cleanJson);
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return {
            type: 'question',
            content: "I'm having trouble thinking right now. Please check your API Key in Settings.",
        };
    }
};

export const editSelection = async (selection, instruction, apiKey, editPrompt) => {
    if (!apiKey) {
        return { content: selection }; // Fail safe
    }

    const activeEditPrompt = (editPrompt || DEFAULT_EDIT_PROMPT)
        .replace('{{selection}}', selection)
        .replace('{{instruction}}', instruction);

    try {
        const model = getModel(apiKey);
        const result = await model.generateContent(activeEditPrompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error calling Gemini API for edit:", error);
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

export const createCalendarDiaryNote = async (calendarDate, events, apiKey) => {
    if (!apiKey || !events?.length) return null;

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

    const prompt = `
Turn the following calendar schedule for ${new Date(calendarDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} into a concise diary-style note.

Important rules:
- Calendar entries are plans, not proof that something happened. Use cautious wording such as "was scheduled", "the day was planned around", or "the calendar included".
- ${CALENDAR_USAGE_GUIDANCE}
- Try to piece together a coherent picture of the day by grouping related activities and noticing the likely flow from morning to evening.
- Never invent outcomes, emotions, people, places, or details that are not supported by the calendar.
- Do not overinterpret unclear or abbreviated event titles.
- Account for every event. Put items that do not fit the narrative under a short "Other scheduled items" section.
- Near the end, add a section titled "## Shape of the Day". In two or three sentences, characterise what kind of day the calendar suggests at a higher level—for example focused, fragmented, task-heavy, appointment-led, transitional, logistics-heavy, balanced, or lightly structured. Base this on both the themes of the event titles and the rhythm of the schedule. Do not infer the user's mood, personality, success, or actual experience.
- End with a section titled "## Insight or Observation" containing one concrete, useful, schedule-grounded takeaway. Decide what is most useful: for example a demanding transition, dominant focus block, unusually dense period, long gap, or balance between types of activity. An overlap alone is not a useful warning given how the user uses the calendar; mention it only when the event details provide clear evidence of a genuine conflict. Avoid generic encouragement and do not invent how the user felt.
- Return only clean Markdown for the diary note. Begin with "## Day from My Calendar". Keep the whole note concise.

Calendar events:
${JSON.stringify(eventDetails, null, 2)}
`;

    try {
        const model = getModel(apiKey);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let note = response.text().replace(/^```(?:markdown)?\s*|\s*```$/g, '').trim();
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

const TODO_EXTRACTION_PROMPT = `
You are a task extraction assistant.
Analyze the following text and identify any actionable tasks or "todos".
Return a JSON array of objects, where each object has:
- "text": A concise description of the task.
- "priority": "high", "medium", or "low" based on urgency or importance implied.

If no tasks are found, return an empty array [].
Do NOT use Markdown. Return ONLY raw JSON.

Text to analyze:
"{{text}}"
`;

export const extractTodos = async (text, apiKey) => {
    if (!apiKey) {
        console.warn("Gemini API Key is missing for todo extraction.");
        return [];
    }

    const prompt = TODO_EXTRACTION_PROMPT.replace('{{text}}', text);

    try {
        const model = getModel(apiKey);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textResponse = response.text();

        const cleanJson = textResponse.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (error) {
        console.error("Error extracting todos:", error);
        return [];
    }
};
