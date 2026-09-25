import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page";
import { analysisWorkflow } from "@/config/workflows";

import { AnalyzeClient } from "./analyze-client";

export const metadata: Metadata = { title: "Analyze" };

export default function AnalyzePage() {
  return (
    <PageContainer>
      <PageHeader title={analysisWorkflow.title} description={analysisWorkflow.description} />
      <AnalyzeClient />
    </PageContainer>
  );
}
