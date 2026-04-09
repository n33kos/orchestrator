import type { ViteDevServer } from 'vite'
import { registerQueueRoutes } from './queue'
import { registerSessionRoutes } from './sessions'
import { registerSystemRoutes } from './system'
import { registerDelegatorRoutes } from './delegators'
import { registerPrRoutes } from './pr'
import { registerPlanRoutes } from './plans'
import { registerWorkerRoutes } from './worker'
import { registerSchedulerLogRoutes } from './scheduler-log'
import { registerSpendRoutes } from './spend'
// import { registerArtifactRoutes } from './artifacts'

export function registerAllRoutes(server: ViteDevServer) {
  registerQueueRoutes(server)
  registerSessionRoutes(server)
  registerSystemRoutes(server)
  registerDelegatorRoutes(server)
  registerPrRoutes(server)
  registerPlanRoutes(server)
  registerWorkerRoutes(server)
  registerSchedulerLogRoutes(server)
  registerSpendRoutes(server)
  // registerArtifactRoutes(server)
}
