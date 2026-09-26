import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page";
import { QAPanel } from "@/components/qa/qa-panel";

export const metadata: Metadata = { title: "Live QA" };

export default function QAPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Live QA agent"
        description="An AI tester uses your app in a sandboxed browser every time you save, and reports what breaks."
      />
      <QAPanel />
    </PageContainer>
  );
}
