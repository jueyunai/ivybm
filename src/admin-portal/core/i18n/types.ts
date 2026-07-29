import type {
  PortalModuleLabelKey,
  PortalNavGroup,
  PortalNextStepKey,
  PortalStateKey,
} from '../modules/types'

export interface PortalMessages {
  modules: Record<PortalModuleLabelKey, string>
  navGroups: Record<PortalNavGroup, string>
  states: Record<PortalStateKey, string>
  nextSteps: Record<PortalNextStepKey, string>
}
