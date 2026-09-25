"use client";

import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, BrainCircuitIcon, ListChecksIcon, SparklesIcon } from "lucide-react";

import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { ListGroup } from "@/components/dashboard/list-group";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ListSkeleton, StatGridSkeleton } from "@/components/feedback/skeletons";
import { EmptyState, ErrorState } from "@/components/feedback/states";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { toUserError } from "@/lib/errors";
import { healthQuery, tasksQuery } from "@/lib/queries/ai";

export function OverviewPanels() {
  const health = useQuery(healthQuery());
  const tasks = useQuery({ ...tasksQuery(), enabled: health.isSuccess });

  if (health.isPending) {
    return (
      <div className="flex flex-col gap-10">
        <StatGridSkeleton />
        <ListSkeleton />
      </div>
    );
  }

  if (health.isError) {
    return (
      <ErrorState
        error={{
          ...toUserError(health.error),
          title: "Backend unreachable",
          description: "Start the API (pnpm dev in apps/api) and try again.",
        }}
        onRetry={() => void health.refetch()}
        className="rounded-xl bg-card shadow-card"
      />
    );
  }

  const aiReady = health.data.ai === "configured";

  return (
    <div className="flex flex-col gap-10">
      <StatGrid>
        <StatCard
          label="API"
          icon={ActivityIcon}
          value={<StatusBadge status="ok">Operational</StatusBadge>}
          hint={`${health.data.service} v${health.data.version}`}
        />
        <StatCard
          label="AI model"
          icon={BrainCircuitIcon}
          value={
            <StatusBadge status={aiReady ? "ok" : "warning"}>
              {aiReady ? "Connected" : "Not configured"}
            </StatusBadge>
          }
          hint={aiReady ? "Gemini is ready" : "Set GEMINI_API_KEY on the API"}
        />
        <StatCard
          label="AI tasks"
          icon={ListChecksIcon}
          value={tasks.data?.length ?? "—"}
          hint="Registered prompt templates"
        />
      </StatGrid>

      <Section title="Available tasks" description="Call any of these with POST /api/v1/process.">
        {tasks.isPending ? (
          <ListSkeleton />
        ) : tasks.isError ? (
          <ErrorState error={toUserError(tasks.error)} onRetry={() => void tasks.refetch()} />
        ) : tasks.data.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Register one in apps/api/src/valt_api/prompts/."
          />
        ) : (
          <ListGroup
            items={tasks.data.map((t) => ({
              id: t.name,
              icon: SparklesIcon,
              title: <span className="font-mono">{t.name}</span>,
              description: t.description,
              trailing: (
                <Badge variant={t.output_schema ? "secondary" : "outline"}>
                  {t.output_schema ? "Structured" : "Text"}
                </Badge>
              ),
            }))}
          />
        )}
      </Section>
    </div>
  );
}
