#!/usr/bin/env node

import { createServer } from '../src/server.js';

const projectDir = process.env.POS_SUPERVISOR_PROJECT_DIR || process.cwd();
const httpPort = process.env.POS_SUPERVISOR_HTTP_PORT ? Number(process.env.POS_SUPERVISOR_HTTP_PORT) : 0;

createServer({ projectDir, httpPort });
