import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuestMenuPage } from './GuestMenuPage.js';

function menu(name: string) {
  return { brand: { name: 'Brand' }, outlet: { name: 'Outlet' }, tableLabel: null,
    categories: [{ publicCategoryRef: 'cat', name, itemRefs: [] }], items: [] };
}
function response(name: string) {
  return new Response(JSON.stringify(menu(name)), { status: 200 });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps the latest selected language when an older request resolves last', async () => {
  let resolveRu!: (value: Response) => void;
  let resolveVi!: (value: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(response('English'))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRu = resolve; }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveVi = resolve; }));
  vi.stubGlobal('fetch', fetchMock);
  render(<GuestMenuPage opaqueToken="t" />);
  await screen.findByText('English');
  fireEvent.click(screen.getByRole('button', { name: 'RU' }));
  await waitFor(() => expect(resolveRu).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'VI' }));
  await waitFor(() => expect(resolveVi).toBeTypeOf('function'));
  resolveVi(response('Tiếng Việt'));
  await screen.findByText('Tiếng Việt');
  await act(async () => { resolveRu(response('Русский')); });
  expect(screen.queryByText('Русский')).toBeNull();
  expect(screen.getByText('Tiếng Việt')).toBeTruthy();
});

it('offers a retry after a failed read', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response('Menu restored'));
  vi.stubGlobal('fetch', fetchMock);
  render(<GuestMenuPage opaqueToken="t" />);
  expect((await screen.findByRole('alert')).textContent).toContain('Menu unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Menu restored')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not display a previous token menu or a stale response after the token changes', async () => {
  let resolveOld!: (value: Response) => void;
  const fetchMock = vi.fn().mockResolvedValueOnce(response('Old menu'))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce(response('New menu'));
  vi.stubGlobal('fetch', fetchMock);
  const app = render(<GuestMenuPage opaqueToken="old" />);
  await screen.findByText('Old menu');
  fireEvent.click(screen.getByRole('button', { name: 'RU' }));
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  app.rerender(<GuestMenuPage opaqueToken="new" />);
  expect(screen.queryByText('Old menu')).toBeNull();
  await screen.findByText('New menu');
  await act(async () => { resolveOld(response('Stale menu')); });
  expect(screen.queryByText('Stale menu')).toBeNull();
  expect(screen.getByText('New menu')).toBeTruthy();
});
