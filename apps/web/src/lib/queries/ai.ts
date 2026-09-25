import type { AnalysisResult, AnalyzeRequest, GenerateRequest, ProcessRequest } from "@valt/shared";
import { queryOptions, useMutation } from "@tanstack/react-query";

import { analyze, generate, getHealth, listTasks, processTask, uploadFile } from "@/lib/api";

/** Query keys — always build keys here so invalidation stays consistent. */
export const aiKeys = {
  all: ["ai"] as const,
  health: () => [...aiKeys.all, "health"] as const,
  tasks: () => [...aiKeys.all, "tasks"] as const,
};

export const healthQuery = () =>
  queryOptions({ queryKey: aiKeys.health(), queryFn: getHealth, staleTime: 15_000, retry: 1 });

export const tasksQuery = () =>
  queryOptions({ queryKey: aiKeys.tasks(), queryFn: listTasks, staleTime: 5 * 60_000 });

// Mutations. For multi-step flows (upload → analyze) prefer useAiWorkflow, which adds cancel,
// stages, and elapsed time on top of these same API functions.

export function useUploadFile() {
  return useMutation({ mutationFn: (file: File | Blob) => uploadFile(file) });
}

export function useAnalyze<T = AnalysisResult>() {
  return useMutation({ mutationFn: (req: AnalyzeRequest) => analyze<T>(req) });
}

export function useProcessTask<T = Record<string, unknown> | string>() {
  return useMutation({ mutationFn: (req: ProcessRequest) => processTask<T>(req) });
}

export function useGenerate() {
  return useMutation({ mutationFn: (req: GenerateRequest) => generate(req) });
}
