import { useCallback, useState } from "react";

export type ToastApi = { show: (text: string) => void };

export function useToast(): [string | null, ToastApi] {
  const [text, setText] = useState<string | null>(null);
  const show = useCallback((t: string) => {
    setText(t);
    window.setTimeout(() => setText((cur) => (cur === t ? null : cur)), 4000);
  }, []);
  return [text, { show }];
}

export function Toast({ text }: { text: string | null }) {
  return (
    <div className="toast-region" role="status" aria-live="polite" data-testid="toast">
      {text && <div className="toast">{text}</div>}
    </div>
  );
}
