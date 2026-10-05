import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./api', () => ({ demo: false, getJson: api.getJson }));
import { useSessionTarget } from './queries';

const id = 'codex-12345678-1234-1234-1234-123456789012';
const app = { name: 'Codex', url: 'codex://threads/12345678-1234-1234-1234-123456789012' };
let root: Root;
let client: QueryClient;
let container: HTMLDivElement;

function InboxAction() {
  const { data } = useSessionTarget(id);
  return data?.app ? <a href={data.app.url}>Open in {data.app.name}</a> : <button type="button">Open session</button>;
}

beforeEach(() => {
  api.getJson.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new QueryClient();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAction(status = 'success') {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <InboxAction />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await vi.waitFor(() => expect(client.getQueryState(['session-target', id])?.status).toBe(status));
  });
}

test('the inbox gets a native app link from the lightweight endpoint', async () => {
  api.getJson.mockResolvedValue({ app });
  await renderAction();
  expect(container.querySelector('a')?.getAttribute('href')).toBe(app.url);
  expect(api.getJson.mock.calls).toEqual([[`/api/session-target?id=${id}`]]);
});

test('a missing session or a failing server leaves the panel action', async () => {
  for (const status of [404, 503]) {
    api.getJson.mockReset().mockRejectedValue(Object.assign(new Error('No'), { status }));
    client.clear();
    await renderAction('error');
    expect(api.getJson).toHaveBeenCalledTimes(1);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')?.textContent).toBe('Open session');
  }
});
