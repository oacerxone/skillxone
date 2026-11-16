import type { AgentAdapter } from '../types';
import { claudeCode } from './claude-code';
import { codex } from './codex';

/** Supported agents, in display order. Add a new adapter here and nowhere else. */
export const AGENTS: readonly AgentAdapter[] = [claudeCode, codex];
