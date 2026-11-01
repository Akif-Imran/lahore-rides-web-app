import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { makeQueryClient } from '@/lib/query-client';

/**
 * Renders with the app's real QueryClient configuration (retry policy, mutation rules), only
 * shortening the retry backoff so failure paths finish in milliseconds instead of seconds.
 * Pass a long `retryDelay` to test behaviour *during* the backoff window.
 */
export function renderWithClient(
  ui: ReactElement,
  options: { retryDelay?: number } = {},
): RenderResult & {
  user: UserEvent;
  queryClient: ReturnType<typeof makeQueryClient>;
} {
  const queryClient = makeQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retryDelay: options.retryDelay ?? 5 },
  });
  const user = userEvent.setup();
  const result = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...result, user, queryClient };
}
