// Thin shim: the Curator LLM is Google Gemini 2.5 Flash Lite (see lib/llm/gemini.ts).
// This file is retained only to keep existing import paths stable
// (e.g. app/api/curator/recommend, lib/curator/*). Do not add logic here.
export { generateJson } from './gemini'
