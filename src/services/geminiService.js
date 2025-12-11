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
