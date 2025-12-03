import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// Initialize the API client
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const SYSTEM_PROMPT = `
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

export const askGemini = async (text, history = []) => {
    if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
        console.warn("Gemini API Key is missing.");
        return {
            type: 'suggestion',
            content: "I can't connect to my brain right now because the API key is missing. Please add your VITE_GEMINI_API_KEY to the .env file.",
        };
    }

    try {
        let promptParts = [SYSTEM_PROMPT];

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
            content: "I'm having trouble thinking right now. Maybe try again in a moment?",
        };
    }
};

export const editSelection = async (selection, instruction) => {
    if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
        return { content: selection }; // Fail safe
    }

    const EDIT_PROMPT = `
    You are a helpful writing assistant.
    The user has selected the following text: "${selection}"
    
    The user wants you to: "${instruction}"
    
    Return ONLY the new text that should replace the selection. 
    Do not add any explanations, quotes, or markdown unless requested.
    If the user asks a question instead of an edit, answer the question but prefix it with "[ANSWER]: ".
    `;

    try {
        const result = await model.generateContent(EDIT_PROMPT);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error calling Gemini API for edit:", error);
        return selection;
    }
};
