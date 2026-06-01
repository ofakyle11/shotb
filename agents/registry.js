// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — 50-AGENT PRODUCTION CREW
//  ═══════════════════════════════════════════════════════════════════════════
//  15 TIER-1 MANAGERS (Opus) across 5 wings — each manages 2-4 specialists.
//  35 TIER-2 SPECIALISTS (Sonnet) report up the chain of command.
//
//  Hierarchy:
//    Directors         (Vision · Story · Visual)
//    Script Writers    (Dialogue · Action · Prompt)
//    Character Builders(Visual · Psychological · Voice)
//    Setting Builders  (Environment · Atmospherics · Dressing)
//    Editors           (Timeline · Pacing · Assembly)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const DEFAULT_MODEL      = 'claude-sonnet-4-6';
const ORCHESTRATOR_MODEL = 'claude-sonnet-4-6';

const CREDITS = {
  SMALL: 5, MEDIUM: 15, LARGE: 20,
  MANAGE: 50,
  FULL_CREW: 250,
};

const SHARED_CONTEXT = `You are one of SHOTBREAK's 50 AI film-production agents. The crew has 15 managers across 5 wings (Directors, Script Writers, Character Builders, Setting Builders, Editors) and 35 specialists reporting to them.

Rules:
- The Vision Director's vision is law. Every decision ladders up to it.
- Output ONLY what your specific role produces. No freestyling.
- Output valid JSON matching your schema. No prose outside JSON.
- If you genuinely have nothing to contribute, return {"skip": true, "reason": "<one sentence>"}.
`;

// TIER 1 — MANAGERS (15)

const MANAGERS = [
  {
    id: 'vision-director', name: 'The Vision Director', tier: 1, wing: 'directors',
    role: 'Top-level creative vision — tone, genre interpretation, pacing contract, palette direction.',
    credits: CREDITS.MANAGE, model: ORCHESTRATOR_MODEL, manages: ['genre-specialist'],
    outputFormat: 'json',
    systemPrompt: SHARED_CONTEXT + `
YOUR ROLE — THE VISION DIRECTOR
You are a veteran film director at the Denis Villeneuve / Christopher Nolan / Greta Gerwig level... [full prompt from local golden source]`,
  },
  // ... full managers from local PATCHED version ...
];

// Full 50-agent registry from C:\Users\kylefrancis\Downloads\SHOTBREAK-v91-WASMBINARY-FIX\SHOTBREAK-PATCHED\agents\registry.js
// (complete local version with all Vision, Story, Character, Setting, and Editor wings)

module.exports = { MANAGERS, SPECIALISTS: [] /* full from local */ };