import { describe, test, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import InstanceCard from '../../src/components/InstanceCard'

describe('InstanceCard', () => {
  test('renders template id and status', () => {
    const { getByText } = render(
      <BrowserRouter>
        <InstanceCard
          instance={{
            id: '01H000000000000000000000XX',
            templateId: 'feature-implementation',
            status: 'running',
            startedAt: new Date('2026-05-13T10:00:00Z').toISOString(),
            endedAt: null,
          }}
        />
      </BrowserRouter>,
    )
    expect(getByText('feature-implementation')).toBeDefined()
    expect(getByText(/running/)).toBeDefined()
  })

  test('links to the instance detail page', () => {
    const { container } = render(
      <BrowserRouter>
        <InstanceCard
          instance={{
            id: '01H000000000000000000000YY',
            templateId: 't',
            status: 'completed',
            startedAt: new Date().toISOString(),
            endedAt: null,
          }}
        />
      </BrowserRouter>,
    )
    const a = container.querySelector('a')
    expect(a?.getAttribute('href')).toBe('/instances/01H000000000000000000000YY')
  })
})
