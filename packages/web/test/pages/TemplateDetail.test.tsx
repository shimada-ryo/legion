import { describe, test, expect, afterEach, beforeEach, mock } from 'bun:test'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TemplateDetail from '../../src/pages/TemplateDetail'
import { ThemeProvider } from '../../src/theme/ThemeProvider'

const TEMPLATE = {
  id: 'feature-with-review',
  name: 'Feature with Reviewer',
  nodes: [
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
  ],
  edges: [],
}

type CapturedCall = { url: string; init: { method?: string; body?: string } | undefined }

function setupFetch(capture: CapturedCall[], triggerResponse: () => Response): void {
  ;(globalThis as { fetch: typeof fetch }).fetch = mock(
    (url: string, init?: { method?: string; body?: string }) => {
      capture.push({ url, init })
      if (url === `/api/templates/${TEMPLATE.id}`) {
        return Promise.resolve(new Response(JSON.stringify(TEMPLATE), { status: 200 }))
      }
      if (url === '/api/workflows/trigger') {
        return Promise.resolve(triggerResponse())
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }))
    },
  ) as unknown as typeof fetch
}

function renderAt(path: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/templates/:id" element={<TemplateDetail />} />
          <Route path="/instances/:id" element={<div data-testid="instance-page">at-instance</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('TemplateDetail trigger form', () => {
  let calls: CapturedCall[]
  beforeEach(() => {
    calls = []
    ;(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      media: '',
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })
  })
  afterEach(() => cleanup())

  test('renders the trigger form after the template loads', async () => {
    setupFetch(calls, () => new Response(JSON.stringify({ workflowInstanceId: 'wf-1' }), { status: 202 }))
    renderAt(`/templates/${TEMPLATE.id}`)

    const textarea = await waitFor(() =>
      screen.getByPlaceholderText('What should the Director do?'),
    )
    expect(textarea).toBeDefined()
    expect(screen.getByRole('button', { name: /Trigger workflow/i })).toBeDefined()
    expect(screen.getByPlaceholderText('HEAD')).toBeDefined()
  })

  test('empty user prompt shows a warning and does not call the API', async () => {
    setupFetch(calls, () => new Response('{}', { status: 202 }))
    renderAt(`/templates/${TEMPLATE.id}`)

    const button = await waitFor(() => screen.getByRole('button', { name: /Trigger workflow/i }))
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/required/i))
    expect(calls.some((c) => c.url === '/api/workflows/trigger')).toBe(false)
  })

  test('submits userPrompt + baseRef and navigates to the new instance on success', async () => {
    setupFetch(
      calls,
      () => new Response(JSON.stringify({ workflowInstanceId: 'wf-42' }), { status: 202 }),
    )
    renderAt(`/templates/${TEMPLATE.id}`)

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText('What should the Director do?'),
    )) as HTMLTextAreaElement
    const baseRefInput = screen.getByPlaceholderText('HEAD') as HTMLInputElement

    fireEvent.change(textarea, { target: { value: 'Add welcome message.' } })
    fireEvent.change(baseRefInput, { target: { value: 'feature/x' } })
    fireEvent.click(screen.getByRole('button', { name: /Trigger workflow/i }))

    await waitFor(() => screen.getByTestId('instance-page'))

    const triggerCall = calls.find((c) => c.url === '/api/workflows/trigger')
    expect(triggerCall).toBeDefined()
    const body = JSON.parse(triggerCall!.init!.body ?? '{}')
    expect(body).toEqual({
      templateId: TEMPLATE.id,
      userPrompt: 'Add welcome message.',
      baseRef: 'feature/x',
    })
  })

  test('omits baseRef from the body when the input is left empty', async () => {
    setupFetch(
      calls,
      () => new Response(JSON.stringify({ workflowInstanceId: 'wf-7' }), { status: 202 }),
    )
    renderAt(`/templates/${TEMPLATE.id}`)

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText('What should the Director do?'),
    )) as HTMLTextAreaElement

    fireEvent.change(textarea, { target: { value: 'Do thing.' } })
    fireEvent.click(screen.getByRole('button', { name: /Trigger workflow/i }))

    await waitFor(() => screen.getByTestId('instance-page'))

    const triggerCall = calls.find((c) => c.url === '/api/workflows/trigger')
    const body = JSON.parse(triggerCall!.init!.body ?? '{}')
    expect(body.baseRef).toBeUndefined()
  })

  test('shows the server error inline on failed trigger', async () => {
    setupFetch(calls, () => new Response('boom', { status: 500 }))
    renderAt(`/templates/${TEMPLATE.id}`)

    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText('What should the Director do?'),
    )) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Do thing.' } })
    fireEvent.click(screen.getByRole('button', { name: /Trigger workflow/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/500/))
    // Button should be re-enabled so the user can retry.
    expect((screen.getByRole('button', { name: /Trigger workflow/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})
