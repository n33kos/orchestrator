import type { ViteDevServer } from 'vite'
import { registerQueueRoutes } from './queue'
import { registerSessionRoutes } from './sessions'
import { registerSystemRoutes } from './system'
import { registerDelegatorRoutes } from './delegators'
import { registerPrRoutes } from './pr'
import { registerPlanRoutes } from './plans'
import { registerTrainingRoutes } from './training'
import { registerWorkerRoutes } from './worker'

export function registerAllRoutes(server: ViteDevServer) {
  registerQueueRoutes(server)
  registerSessionRoutes(server)
  registerSystemRoutes(server)
  registerDelegatorRoutes(server)
  registerPrRoutes(server)
  registerPlanRoutes(server)
  registerTrainingRoutes(server)
  registerWorkerRoutes(server)
}
