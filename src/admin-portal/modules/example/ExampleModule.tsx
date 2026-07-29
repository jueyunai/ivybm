import { PortalState, Surface } from '@/admin-portal/core/ui'

export type ExampleModuleState = 'available' | 'dependency-gated' | 'error' | 'forbidden'

export function ExampleModule({ state }: { state: ExampleModuleState }) {
  if (state !== 'available') {
    const copy = {
      'dependency-gated': {
        description: 'Keep the command disabled until its typed domain dependency is ready.',
        title: 'Dependency not ready',
        type: 'dependency-gated' as const,
      },
      error: {
        description: 'A read failure must not be rendered as an empty result.',
        title: 'Example read failed',
        type: 'error' as const,
      },
      forbidden: {
        description: 'The server role guard rejected this module before loading domain data.',
        title: 'Example access denied',
        type: 'forbidden' as const,
      },
    }[state]

    return (
      <main className="portal-page">
        <PortalState {...copy} />
      </main>
    )
  }

  return (
    <main className="portal-page">
      <header className="portal-page__intro">
        <div>
          <p className="portal-page__eyebrow">MODULE EXAMPLE</p>
          <h2>Example module</h2>
          <p>Portal Core public primitives provide the visual and state contract.</p>
        </div>
      </header>
      <Surface as="section">
        <h3>Replace this surface with a bounded domain read model.</h3>
        <p>Keep authorization, commands, errors, and maintenance ownership explicit.</p>
      </Surface>
    </main>
  )
}
