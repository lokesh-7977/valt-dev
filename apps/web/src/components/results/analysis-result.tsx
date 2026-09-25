"use client";

import type { AnalysisResult, AnalyzeResponse } from "@valt/shared";
import { BracesIcon, CopyIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { JsonView } from "@/components/ai/json-view";
import {
  ConfidenceMeter,
  FactList,
  KeyPoints,
  RecommendedActions,
  TagList,
} from "@/components/ai/result-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { WorkflowInput } from "@/lib/workflow/types";

const SENTIMENT = {
  positive: { label: "Positive", variant: "success" },
  neutral: { label: "Neutral", variant: "secondary" },
  negative: { label: "Negative", variant: "destructive" },
  mixed: { label: "Mixed", variant: "warning" },
} as const;

/** Result screen for the generic AnalysisResult shape. Copy this file for a domain result. */
export function AnalysisResultView({
  result,
  input,
  onReset,
}: {
  result: AnalyzeResponse<AnalysisResult>;
  input: WorkflowInput;
  onReset: () => void;
}) {
  const r = result.result;
  const sentiment = r.sentiment ? SENTIMENT[r.sentiment] : null;

  const copy = async () => {
    const text = [
      r.summary,
      "",
      ...r.key_points.map((p) => `• ${p}`),
      ...(r.recommended_actions.length
        ? ["", "Next steps:", ...r.recommended_actions.map((a, i) => `${i + 1}. ${a}`)]
        : []),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-title-3 font-semibold">Analysis</h2>
          {sentiment && (
            <Badge variant={sentiment.variant}>
              <span className="sr-only">Sentiment: </span>
              {sentiment.label}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={copy}>
            <CopyIcon data-icon="inline-start" /> Copy
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <BracesIcon data-icon="inline-start" /> Details
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Structured result</DialogTitle>
                <DialogDescription>Everything the model returned.</DialogDescription>
              </DialogHeader>
              <JsonView value={r} />
            </DialogContent>
          </Dialog>
          <Button variant="secondary" size="sm" onClick={onReset}>
            <PlusIcon data-icon="inline-start" /> New analysis
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-footnote font-semibold text-muted-foreground">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-title-3 font-normal text-pretty">{r.summary}</p>
            </CardContent>
          </Card>
          <RecommendedActions actions={r.recommended_actions} />
          <KeyPoints points={r.key_points} />
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <ConfidenceMeter value={r.confidence} />
              <FactList
                facts={[
                  { label: "Inputs", value: describeInput(input) },
                  {
                    label: "Model",
                    value: <span className="font-mono text-footnote">{result.model}</span>,
                  },
                  ...(result.usage?.total_tokens
                    ? [{ label: "Tokens", value: result.usage.total_tokens.toLocaleString() }]
                    : []),
                ]}
              />
            </CardContent>
          </Card>
          {r.entities.length > 0 && (
            <Card>
              <CardContent>
                <TagList
                  title="Mentioned"
                  items={r.entities.map((e) => ({ label: e.name, hint: e.type }))}
                />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function describeInput(input: WorkflowInput): string {
  const parts: string[] = [];
  if (input.text.trim()) parts.push("text");
  const count = (prefix: string) => input.files.filter((f) => f.type.startsWith(prefix)).length;
  const images = count("image/");
  const audio = count("audio/");
  const other = input.files.length - images - audio;
  if (images) parts.push(`${images} image${images > 1 ? "s" : ""}`);
  if (audio) parts.push(`${audio} audio`);
  if (other) parts.push(`${other} file${other > 1 ? "s" : ""}`);
  return parts.join(", ") || "—";
}
