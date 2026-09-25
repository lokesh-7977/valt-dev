# TanStack Query v5 with the Next.js App Router

```bash
pnpm --filter @valt/web add @tanstack/react-query
pnpm --filter @valt/web add -D @tanstack/react-query-devtools
```

## Query client — per request on the server, singleton in the browser

```ts
// apps/web/src/lib/query-client.ts
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000 },
      dehydrate: {
        // also hand pending queries to the client so streamed prefetches work
        shouldDehydrateQuery: (q) =>
          defaultShouldDehydrateQuery(q) || q.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) return makeQueryClient(); // never share across requests/users
  return (browserQueryClient ??= makeQueryClient());
}
```

## Providers

```tsx
// apps/web/src/components/providers.tsx
"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { getQueryClient } from "@/lib/query-client";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* tree-shaken out of production builds */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

```tsx
// apps/web/src/app/layout.tsx (body)
<body>
  <Providers>{children}</Providers>
</body>
```

## Key factory + queryOptions per feature

Uses the real `/api/v1/items` endpoints and `@valt/shared` types.

```ts
// apps/web/src/lib/queries/items.ts
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Item, ItemCreate } from "@valt/shared";
import { apiFetch } from "@/lib/api";

export const itemKeys = {
  all: ["items"] as const,
  list: () => [...itemKeys.all, "list"] as const,
  detail: (id: number) => [...itemKeys.all, "detail", id] as const,
};

export const itemQueries = {
  list: () =>
    queryOptions({
      queryKey: itemKeys.list(),
      queryFn: () => apiFetch<Item[]>("/items"),
    }),
  detail: (id: number) =>
    queryOptions({
      queryKey: itemKeys.detail(id),
      queryFn: () => apiFetch<Item>(`/items/${id}`),
    }),
};

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemCreate) =>
      apiFetch<Item>("/items", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (item) => {
      queryClient.setQueryData(itemKeys.detail(item.id), item);
      return queryClient.invalidateQueries({ queryKey: itemKeys.list() });
    },
  });
}
```

`queryOptions` gives the same key + fetcher (and types) to `prefetchQuery`, `useQuery`,
`useSuspenseQuery`, and `getQueryData`, so server and client can't drift.

## Prefetch on the server, consume on the client

```tsx
// apps/web/src/app/items/page.tsx  (server component)
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { itemQueries } from "@/lib/queries/items";
import { ItemList } from "@/components/items/item-list";

export default async function ItemsPage() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(itemQueries.list());
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ItemList />
    </HydrationBoundary>
  );
}
```

```tsx
// apps/web/src/components/items/item-list.tsx
"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { itemQueries } from "@/lib/queries/items";

export function ItemList() {
  const { data: items } = useSuspenseQuery(itemQueries.list()); // hydrated, no loading flash
  return (
    <ul className="divide-y divide-border rounded-lg border">
      {items.map((item) => (
        <li key={item.id} className="p-3 text-sm">{item.name}</li>
      ))}
    </ul>
  );
}
```

`apiFetch` works on the server because it uses `API_INTERNAL_URL` there.

## Mutation in a component

```tsx
const createItem = useCreateItem();

<Button disabled={createItem.isPending} onClick={() => createItem.mutate({ name })}>
  {createItem.isPending ? "Saving…" : "Add item"}
</Button>
{createItem.isError && (
  <p role="alert" className="text-sm text-destructive">Couldn't save. Try again.</p>
)}
```

## Optimistic update (only when the UX needs it)

```ts
useMutation({
  mutationFn: updateItem,
  onMutate: async (next: Item) => {
    await queryClient.cancelQueries({ queryKey: itemKeys.detail(next.id) });
    const prev = queryClient.getQueryData(itemKeys.detail(next.id));
    queryClient.setQueryData(itemKeys.detail(next.id), next);
    return { prev };
  },
  onError: (_err, next, ctx) => {
    if (ctx?.prev) queryClient.setQueryData(itemKeys.detail(next.id), ctx.prev);
  },
  onSettled: (_d, _e, next) =>
    queryClient.invalidateQueries({ queryKey: itemKeys.detail(next.id) }),
});
```

## URL-driven lists

Put filters/page cursor in search params and in the query key:

```ts
const params = useSearchParams();
const q = params.get("q") ?? "";
useQuery({
  queryKey: [...itemKeys.list(), { q }],
  queryFn: () => apiFetch<Item[]>(`/items?q=${encodeURIComponent(q)}`),
  placeholderData: keepPreviousData, // no flash between pages
});
```
