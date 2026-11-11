// Lists the Gemini models the key can call with generateContent.
export const listModels = async (apiKey) => {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': apiKey } });
    if (!response.ok) return [];
    return ((await response.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
};
