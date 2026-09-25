import { CompassIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/states";
import { PageContainer } from "@/components/layout/page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer narrow>
      <EmptyState
        icon={CompassIcon}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
