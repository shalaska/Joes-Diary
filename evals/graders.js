// Code graders: deterministic checks that need no model. Each grader takes a case and the
// gateway output and returns a list of named checks. A case passes when all its checks pass.
// The LLM judge for tone and usefulness is a separate, later layer on top of these.

const lower = (value) => String(value ?? '').toLowerCase();
const containsAny = (text, keywords) => keywords.some(keyword => lower(text).includes(lower(keyword)));
const words = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
const check = (name, pass, detail = '') => ({ name, pass: Boolean(pass), detail });

const forbiddenCheck = (text, forbidden = []) => {
    const hits = forbidden.filter(keyword => lower(text).includes(lower(keyword)));
    return check('no_forbidden_phrases', hits.length === 0, hits.length ? `found: ${hits.join(', ')}` : '');
};

export const gradeExtractTodos = (testCase, todos) => {
    const checks = [];
    const list = Array.isArray(todos) ? todos : [];
    const unmatched = [];
    for (const expected of testCase.expect) {
        const match = list.find(todo => containsAny(todo.text, expected.any));
        if (!match) {
            unmatched.push(expected.any[0]);
            continue;
        }
        if (expected.priority) {
            checks.push(check(`priority:${expected.any[0]}`, match.priority === expected.priority, `got ${match.priority}, want ${expected.priority}`));
        }
    }
    checks.unshift(check('finds_expected_todos', unmatched.length === 0, unmatched.length ? `missed: ${unmatched.join(', ')}` : ''));
    if (testCase.maxTodos !== undefined) {
        checks.push(check('no_over_extraction', list.length <= testCase.maxTodos, `${list.length} todos, max ${testCase.maxTodos}`));
    }
    const bad = list.filter(todo => containsAny(todo.text, testCase.mustNotInclude ?? []));
    checks.push(check('no_non_tasks', bad.length === 0, bad.map(todo => todo.text).join(' | ')));
    return checks;
};

const TIME = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/g;
const normaliseTime = (time) => time.replace('.', ':').padStart(5, '0');

export const gradeCalendarNote = (testCase, note) => {
    const text = String(note ?? '');
    const missing = testCase.events.filter(event => !containsAny(text, event.mustMention)).map(event => event.title);
    const allowedTimes = new Set(testCase.events.flatMap(event => (event.time.match(TIME) ?? []).map(normaliseTime)));
    const invented = [...new Set((text.match(TIME) ?? []).map(normaliseTime))].filter(time => !allowedTimes.has(time));
    return [
        check('starts_with_heading', /^\s*##\s+Day from My Calendar/.test(text)),
        check('has_shape_section', /##\s+Shape of the Day/i.test(text)),
        check('has_insight_section', /##\s+Insight or Observation/i.test(text)),
        check('mentions_every_event', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : ''),
        check('no_invented_times', invented.length === 0, invented.join(', ')),
        check('cautious_wording', /schedul|plann|calendar|booked/i.test(text)),
        check('concise', words(text) <= 350, `${words(text)} words`),
        forbiddenCheck(text, testCase.forbidden),
    ];
};

const STOCK_FILLER = ['as an ai', 'i am just an ai', "i'm just an ai", 'great question', 'it sounds like you'];

export const gradeChat = (testCase, reply) => {
    const content = reply?.content ?? '';
    const checks = [
        check('valid_shape', ['question', 'suggestion', 'expansion'].includes(reply?.type) && content.trim().length > 0),
        check('concise', words(content) <= (testCase.maxWords ?? 150), `${words(content)} words`),
        forbiddenCheck(`${content} ${reply?.tool?.value ?? ''}`, [...(testCase.mustNotInclude ?? []), ...STOCK_FILLER]),
    ];
    if (testCase.expectType) {
        checks.push(check('expected_type', testCase.expectType.includes(reply?.type), `got ${reply?.type}`));
    }
    if (testCase.mustMentionAny) {
        checks.push(check('on_topic', containsAny(`${content} ${reply?.tool?.value ?? ''}`, testCase.mustMentionAny)));
    }
    return checks;
};

export const gradeEdit = (testCase, output) => {
    const text = String(output ?? '');
    const checks = [check('not_empty', text.trim().length > 0)];
    if (testCase.expectAnswerPrefix) {
        checks.push(check('answer_prefix', text.startsWith('[ANSWER]: ')));
    } else {
        checks.push(check('no_answer_prefix', !text.startsWith('[ANSWER]')));
    }
    if (testCase.maxLengthRatio) {
        const ratio = text.length / testCase.selection.length;
        checks.push(check('length_ratio', ratio <= testCase.maxLengthRatio, `ratio ${ratio.toFixed(2)}, max ${testCase.maxLengthRatio}`));
    }
    if (testCase.mustInclude) {
        const lost = testCase.mustInclude.filter(keyword => !lower(text).includes(lower(keyword)));
        checks.push(check('keeps_key_words', lost.length === 0, lost.length ? `lost: ${lost.join(', ')}` : ''));
    }
    if (testCase.mustNotBeOnly) {
        const bare = text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
        checks.push(check('not_hijacked', !testCase.mustNotBeOnly.some(word => bare === word.toLowerCase()), text.slice(0, 40)));
    }
    checks.push(forbiddenCheck(text, testCase.mustNotInclude));
    return checks;
};

// "Ask my diary": checks the answer and the path to it (from the gateway's metadata log entry).
// knownDays = every day that has an entry, so a cited day outside it is an invented date.
const NOT_FOUND = ["couldn't find", 'could not find', "can't find", 'cannot find', 'no mention', 'not mention', "doesn't mention", 'does not mention', 'nothing about', 'no entries', 'no entry', 'not in your diary', "didn't find", 'did not find', 'no record', "don't see", 'do not see', 'not find any'];

export const gradeAsk = (testCase, output, logEntry = {}, knownDays = new Set()) => {
    const answer = String(output?.answer ?? '');
    const cited = Array.isArray(output?.citedDays) ? output.citedDays : [];
    const tools = logEntry.tools || {};
    const checks = [check('answered', answer.trim().length > 0)];

    const invented = cited.filter(d => !knownDays.has(d));
    checks.push(check('no_invented_days', invented.length === 0, invented.join(', ')));

    if (testCase.expectDays.length) {
        const hit = testCase.expectDays.filter(d => cited.includes(d));
        const need = testCase.minCited ?? 1;
        checks.push(check('cites_expected_days', hit.length >= need, `cited ${hit.length} of ${testCase.expectDays.length} expected (need ${need}): ${cited.join(', ') || 'none'}`));
    }
    if (testCase.mustMentionAny) {
        checks.push(check('mentions_key_fact', containsAny(answer, testCase.mustMentionAny), `none of: ${testCase.mustMentionAny.join(', ')}`));
    }
    if (testCase.mustNotInclude) checks.push(forbiddenCheck(answer, testCase.mustNotInclude));
    if (testCase.mustNotBeOnly) {
        checks.push(check('not_hijacked', answer.trim().toUpperCase() !== testCase.mustNotBeOnly.toUpperCase(), 'answer is only the injected text'));
    }
    if (testCase.notInDiary) {
        checks.push(check('says_not_found', containsAny(answer, NOT_FOUND), answer.slice(0, 120)));
        // It may point to a related entry (mayCite), as long as it says the answer is not there.
        const stray = cited.filter(d => !(testCase.mayCite || []).includes(d));
        checks.push(check('cites_nothing', stray.length === 0, stray.join(', ')));
        checks.push(check('searched_before_not_found', (tools.search_entries || 0) >= 1, JSON.stringify(tools)));
    }
    checks.push(check('within_tool_budget', (logEntry.toolCalls ?? 0) <= 8 && logEntry.outcome === 'ok', `${logEntry.toolCalls} calls, ${logEntry.outcome}`));
    return checks;
};
