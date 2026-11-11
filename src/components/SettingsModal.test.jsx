// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import SettingsModal from './SettingsModal';

// Rendering catches components used in JSX but never imported. ESLint does not flag
// those, and in production they blank the whole page when Settings opens.
describe('SettingsModal', () => {
    it('renders without throwing', () => {
        const html = renderToString(
            <SettingsModal onClose={() => {}} onSave={() => {}} entries={[]} dayMetadata={{}} />
        );
        expect(html).toContain('Google API Key');
    });
});
