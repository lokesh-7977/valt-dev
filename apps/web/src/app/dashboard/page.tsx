import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page";

import { OverviewPanels } from "./overview-panels";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Overview"
        title="System status"
        description="Live status of the backend and the AI tasks it exposes."
      />
      <OverviewPanels />
    </PageContainer>
  );
}
