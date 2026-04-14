import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDE_PATH = join(__dirname, '..', 'data', 'resources', 'platformos-development-guide.md');

export const loadDevelopmentGuideTool = {
  name: 'load_development_guide',
  description: 'Return the full platformOS development guide (MUST be read at session start). Contains mandatory workflow (Section 0), architecture rules, MUST/MUST NOT constraints, and complete reference. MUST be called once per session before any scaffold, validate_intent, or validate_code work.',
  inputSchema: {},

  createHandler() {
    return async () => {
      const text = await readFile(GUIDE_PATH, 'utf-8');
      return { guide: text, path: GUIDE_PATH };
    };
  },
};
