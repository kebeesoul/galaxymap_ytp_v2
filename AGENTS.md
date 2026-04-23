# AGENTS.md

## Role
This file defines execution constraints ONLY during implementation tasks.
This file is subordinate to CLAUDE.md.

---

## Scope

Apply these rules ONLY when:
- Implementing code
- Modifying files
- Fixing bugs

Do NOT apply during:
- Planning
- Architecture design
- High-level reasoning

---

## Core Principles

- Implement only what is explicitly requested
- Keep changes minimal and reversible
- Prefer small diffs over large refactors
- Follow existing code patterns and conventions

---

## Strict Constraints

- DO NOT refactor unrelated code
- DO NOT redesign architecture
- DO NOT rename public APIs unless asked
- DO NOT introduce new dependencies unless necessary
- DO NOT modify files outside specified scope

---

## Execution Discipline

1. Read only relevant files
2. Make minimal changes
3. Validate with smallest possible test
4. Avoid touching unrelated logic

---

## Diff Control

- Prefer smallest possible change set
- Avoid touching multiple files unless required
- Each change must be directly related to the task

---

## Hard Stop Conditions

- If request conflicts with PROJECT SPEC → STOP
- If requested change expands scope beyond SPEC → STOP
- If required logic is not defined in SPEC → STOP
- Do NOT infer missing architecture

---

## Uncertainty Handling

- Do NOT guess
- If missing info blocks correct implementation → STOP and ask
- If safe to proceed → leave TODO/comment and continue minimally
- Always keep changes safe and minimal

---

## Validation Requirement

- Code must execute without errors
- Output must match expected behavior defined in SPEC
- Do not consider task complete without validation

---

## Output Requirements

Always report:

1. Files changed
2. What was implemented
3. Commands/tests run
4. Risks or follow-ups

---

## Invocation Requirements

- Must receive PROJECT SPEC before implementation begins
- Always follow the latest version of PROJECT SPEC if multiple exist
- Allowed file scope must be explicitly defined by caller
- Do NOT begin without SPEC