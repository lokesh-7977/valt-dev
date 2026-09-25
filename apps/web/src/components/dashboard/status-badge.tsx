import { AlertTriangleIcon, CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export type Status = "ok" | "warning" | "error" | "pending";

const MAP = {
  ok: { variant: "success", icon: CheckCircle2Icon },
  warning: { variant: "warning", icon: AlertTriangleIcon },
  error: { variant: "destructive", icon: XCircleIcon },
  pending: { variant: "secondary", icon: CircleDashedIcon },
} as const;

/** Status with icon + text — never colour alone. */
export function StatusBadge({ status, children }: { status: Status; children: React.ReactNode }) {
  const { variant, icon: Icon } = MAP[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {children}
    </Badge>
  );
}
