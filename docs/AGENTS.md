# SHOTBREAK — 50-Agent Production Crew

This document explains what the 50 AI agents actually do.

## Overview

SHOTBREAK runs a structured film-production crew of 50 specialized agents.

- **15 Tier-1 Managers** (the "directors" of each department)
- **35 Tier-2 Specialists** (the actual workers who produce the detailed output)

The system follows a clear hierarchy:

**Vision Director** (the top creative authority) → other Directors → Specialists → **Showrunner** (final cut / assembly)

Everything ladders up to the Vision Director's taste and rules.

## The 5 Wings

### 1. Directors Wing
Top-level creative control.

**Managers:**
- `vision-director` — The single source of truth for the film's soul, mood, palette, pacing contract, and continuity rules. First agent to run.
- `story-director` — Owns narrative structure, beats, cause-and-effect, Save the Cat / McKee style analysis.
- `visual-director` — Owns the visual language, shot grammar, camera movement philosophy, and overall look.

### 2. Script Writers Wing
Dialogue, action, and prompt engineering.

**Managers:**
- `dialogue-director`
- `action-director`
- `prompt-director`

### 3. Character Builders Wing
Everything about the people on screen.

**Managers:**
- `visual-character-builder` — Canonical descriptions, reference images, wardrobe, props, visual consistency.
- `psychological-builder` — Core wound, desire, obstacle, arc, moral flaw for every named character.
- `voice-builder` — How each character speaks (vocabulary, rhythm, signature patterns).

### 4. Setting Builders Wing
World, environments, and atmosphere.

**Managers:**
- `environment-builder`
- `atmospherics-builder`
- `dressing-builder`

### 5. Editors Wing
Timeline, pacing, and final assembly.

**Managers:**
- `timeline-director`
- `pacing-director`
- `showrunner` (special) — The final assembler. Takes the full plan + all specialist output and produces the actual cut JSON / shot list.

## How a Full Production Works

Typical flow (`full_production` mode):

1. **auteur** (or Vision Director) creates the high-level plan.
2. Managers break the plan down and direct their specialists.
3. Specialists produce detailed structured output (JSON).
4. **showrunner** receives everything and produces the final cut/assembly.

## Current Runtime (Max Power Mode)

As of the current deploy:
- All agents run on **grok-3** (full power model)
- Higher token budgets for richer output
- The abstraction layer (`lib/llm.js`) automatically gives the strongest model to every agent

---

**Note:** The actual detailed instructions for each agent live in `agents/registry.js`. The prompts are quite long and specific — this document is the high-level map.

**Wind & Physics Expert (added to sub-stack):** Specialist for cold wind effects on hair/jackets/clothing (specific fluttering, billowing, snapping, lag phrases), interaction with forcing actions (collar grabs, struggles), and realistic balance/posture/weight shifts on natural rocky uneven terrain near cliff edges. Outputs exact prompt insertion blocks for 6s clips enforcing natural non-stiff physics (inertia, secondary motion, gust variation, footing reactions). Integrated into video prompt construction for cliff scenes (e.g. Brant/Ramsey confrontation).

Generated during the Grok Max Power unification pass.