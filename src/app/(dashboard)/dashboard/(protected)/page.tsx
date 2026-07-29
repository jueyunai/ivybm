import { PortalState } from '@/admin-portal/core/ui'

export default function PortalOverviewPlaceholderPage() {
  return (
    <main style={{ padding: 24 }}>
      <PortalState
        description="Portal Shell 与角色首页将在后续基座 checkpoint 中挂载。"
        title="运营门户正在构建"
        type="dependency-gated"
      />
    </main>
  )
}
