// The "mcp" function's HTTP layer: one handler for /mcp, the sign-in endpoints and the
// /.well-known metadata, plus the adapter between the Node request Firebase hands over and
// the web-standard Request/Response the MCP SDK and the sign-in server use.

export const createConnectorHandler = ({ oauth, mcp }) => async (request) => {
    const { pathname } = new URL(request.url);
    const response = pathname === '/mcp' ? await mcp(request) : await oauth.handle(request);
    return response ?? new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
};

// Headers Node manages itself, or that describe the hop rather than the request.
const HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade']);

// The URL is built on the diary's fixed address, never on the Host header, so a request cannot
// make the server believe it lives somewhere else.
export const toWebRequest = (req, base) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers || {})) {
        if (HOP_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) headers.append(name, String(v));
    }
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    return new Request(new URL(req.originalUrl || req.url || '/', base), {
        method: req.method,
        headers,
        body: hasBody ? (req.rawBody ?? '') : undefined,
    });
};

export const sendWebResponse = async (res, response) => {
    res.status(response.status);
    response.headers.forEach((value, name) => res.set(name, value));
    // Tokens and diary text must never sit in a cache, Firebase Hosting's included.
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(await response.arrayBuffer()));
};
