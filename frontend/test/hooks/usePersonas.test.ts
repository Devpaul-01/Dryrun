import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { HttpResponse, http } from 'msw';
import React from 'react';

import { queryClient } from '@/api/queryClient';
import { env } from '@/config/env';
import { useUploadPersonaSource, usePersona } from '@/hooks/usePersonas';

import { server } from '../mocks/server';

const API = env.apiRoot;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const basePersona = {
  id: 'p1',
  workspace_id: 'ws1',
  created_by_user_id: 'u1',
  name: 'Generating…',
  role: 'Generating…',
  company_context: null,
  main_pain: '',
  skepticism_about: '',
  communication_style: 'professional and direct',
  hidden_motivations: [],
  source_type: 'company_url',
  reusable: true,
  generation_status: 'generating',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('usePersona generation polling', () => {
  afterEach(() => queryClient.clear());

  it('polls while generating and stops once the persona is ready', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/personas/p1`, () => {
        calls += 1;
        return HttpResponse.json({
          persona:
            calls < 2
              ? basePersona
              : { ...basePersona, name: 'Dana', role: 'VP Sales', generation_status: 'ready' },
        });
      }),
    );

    const { result, unmount } = await renderHook(() => usePersona('p1'), { wrapper });
    await waitFor(() => expect(result.current.data?.generation_status).toBe('generating'));
    await waitFor(() => expect(result.current.data?.generation_status).toBe('ready'), { timeout: 6000 });
    expect(result.current.data?.name).toBe('Dana');

    const settled = calls;
    await new Promise((r) => setTimeout(r, 3500));
    expect(calls).toBe(settled); // no further polling after ready
    unmount();
  }, 15000);
});

describe('useUploadPersonaSource', () => {
  afterEach(() => queryClient.clear());

  it('chains signed-url, byte upload and complete, resolving to the upload id', async () => {
    const order: string[] = [];
    let signedBody: unknown;
    server.use(
      http.post(`${API}/uploads/signed-url`, async ({ request }) => {
        order.push('signed-url');
        signedBody = await request.json();
        return HttpResponse.json(
          { upload_id: 'up1', signed_url: 'https://storage.example.test/put/up1', storage_path: 'a/b' },
          { status: 201 },
        );
      }),
      http.put('https://storage.example.test/put/up1', () => {
        order.push('put');
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`${API}/uploads/up1/complete`, () => {
        order.push('complete');
        return HttpResponse.json({ upload_id: 'up1', status: 'processing' });
      }),
      http.get('http://local.test/file.txt', () => new HttpResponse('hello', { status: 200 })),
    );

    const { result, unmount } = await renderHook(() => useUploadPersonaSource(), { wrapper });
    result.current.mutate({ uri: 'http://local.test/file.txt', name: 'file.txt', mimeType: 'text/plain', size: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBe('up1');
    expect(order).toEqual(['signed-url', 'put', 'complete']);
    expect(signedBody).toEqual({
      purpose: 'persona_source',
      filename: 'file.txt',
      mime_type: 'text/plain',
      size_bytes: 5,
    });
    unmount();
  });

  it('does not call complete when the byte upload fails', async () => {
    let completed = false;
    server.use(
      http.post(`${API}/uploads/signed-url`, () =>
        HttpResponse.json(
          { upload_id: 'up2', signed_url: 'https://storage.example.test/put/up2', storage_path: 'a/b' },
          { status: 201 },
        ),
      ),
      http.put('https://storage.example.test/put/up2', () => new HttpResponse(null, { status: 403 })),
      http.post(`${API}/uploads/up2/complete`, () => {
        completed = true;
        return HttpResponse.json({});
      }),
      http.get('http://local.test/file.txt', () => new HttpResponse('hello')),
    );

    const { result, unmount } = await renderHook(() => useUploadPersonaSource(), { wrapper });
    result.current.mutate({ uri: 'http://local.test/file.txt', name: 'file.txt', mimeType: 'text/plain', size: 5 });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(completed).toBe(false);
    unmount();
  });
});
