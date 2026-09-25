"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/feedback/states";
import { PageContainer } from "@/components/layout/page";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer narrow>
      <ErrorState
        error={{
          title: "This page hit a problem",
          description: "Try again. If it keeps happening, reload the page.",
          requestId: error.digest ?? null,
        }}
        onRetry={reset}
      />
    </PageContainer>
  );
}
