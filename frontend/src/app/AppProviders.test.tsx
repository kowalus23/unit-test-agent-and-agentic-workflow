import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useTheme, type DefaultTheme } from 'styled-components'
import { expect, it } from 'vitest'
import { theme } from '../design-system'
import { queryClient } from '../lib/queryClient'
import { createTestQueryClient } from '../test/queryClient'
import { AppProviders } from './AppProviders'

function renderProviders(client?: QueryClient) {
  const seen: { client?: QueryClient; theme?: DefaultTheme } = {}
  function Probe() {
    seen.client = useQueryClient()
    seen.theme = useTheme()
    return <p>Child content</p>
  }
  render(
    <AppProviders client={client}>
      <Probe />
    </AppProviders>,
  )
  return seen
}

it('gives children the injected query client and the theme', () => {
  const client = createTestQueryClient()
  const seen = renderProviders(client)
  expect(screen.getByText('Child content')).toBeVisible()
  expect(seen.client).toBe(client)
  expect(seen.theme).toBe(theme)
})

it('falls back to the application query client', () => {
  expect(renderProviders().client).toBe(queryClient)
})
