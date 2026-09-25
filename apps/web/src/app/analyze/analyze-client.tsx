"use client";

import { AiWorkflow } from "@/components/workflow/ai-workflow";
import { analysisWorkflow } from "@/config/workflows";

// Workflow configs hold functions and components, so they're wired up on the client side.
export function AnalyzeClient() {
  return <AiWorkflow config={analysisWorkflow} />;
}
