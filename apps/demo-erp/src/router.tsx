import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

// A tiny pushState router so the extension sees real SPA navigation (pushState + popstate).
const listeners = new Set<() => void>();

export function navigate(to: string): void {
  history.pushState(null, "", to);
  listeners.forEach((l) => l());
}

export function usePathname(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function Link({ to, children, testId }: { to: string; children: ReactNode; testId?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} data-testid={testId}>
      {children}
    </a>
  );
}
