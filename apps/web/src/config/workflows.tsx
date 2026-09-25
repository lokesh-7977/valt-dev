import type { AnalysisResult, AnalyzeResponse } from "@valt/shared";

import { AnalysisResultView } from "@/components/results/analysis-result";
import { analyze } from "@/lib/api";
import type { WorkflowConfig } from "@/lib/workflow/types";

/**
 * Workflows = copy + limits + which backend call to make + how to show the result.
 * Hackathon day: edit this object (or add a new one) — components don't change.
 *
 * Other `run` examples:
 *   run: ({ text, fileIds, signal }) =>
 *     processTask<Triage>({ task: "triage", text, file_ids: fileIds }, signal)
 *   run: ({ text, fileIds, signal }) =>
 *     analyze<MyShape>({ text, file_ids: fileIds, output_schema: MY_JSON_SCHEMA }, signal)
 *     // → render with <JsonView value={result.result} /> until a custom view exists
 */
export const analysisWorkflow: WorkflowConfig<AnalyzeResponse<AnalysisResult>> = {
  id: "analyze",
  title: "New analysis",
  description:
    "Add text, a document, photos, or a voice note. We'll summarize it, pull out what matters, and suggest what to do next.",
  input: {
    modes: ["text", "file", "image", "audio"],
    textLabel: "What should we look at?",
    textPlaceholder: "Paste notes, a report, an email, or describe the situation…",
    accept: ["application/pdf", "text/plain", "text/markdown", "text/csv", ".md", ".txt", ".csv"],
    maxFiles: 10,
    maxFileMb: 20,
    submitLabel: "Analyze",
    examples: [
      {
        label: "Customer complaint",
        text: "Hi, I ordered a blender 3 weeks ago (order #88213). It arrived with a cracked jar, and I've emailed twice with no reply. I need this sorted before my daughter's birthday on Saturday or I want a full refund.",
      },
      {
        label: "Meeting notes",
        text: "Sync 12 Sep: launch slipping 2 weeks due to payments API rate limits. Priya to talk to vendor about quota. Marketing needs final copy by Friday. Risk: onboarding flow untested on Android.",
      },
    ],
  },
  stages: {
    upload: "Uploading your files",
    analyze: "Analyzing with Gemini",
    analyzeHints: [
      "Reading your input…",
      "Finding the key points…",
      "Checking details and entities…",
      "Working out next steps…",
    ],
    finalize: "Preparing results",
  },
  run: ({ text, fileIds, signal }) => analyze({ text: text || null, file_ids: fileIds }, signal),
  Result: AnalysisResultView,
};
