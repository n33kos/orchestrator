import styles from './App.module.scss'
import { Header } from './components/Header/Header.tsx'
import { WorkStreamList } from './components/WorkStreamList/WorkStreamList.tsx'
import { useQueue } from './hooks/useQueue.ts'

export function App() {
  const queue = useQueue()

  return (
    <div className={styles.Root}>
      <Header
        activeCount={queue.activeItems.length}
        queuedCount={queue.queuedItems.length}
        pausedCount={queue.pausedItems.length}
      />
      <main className={styles.Main}>
        <WorkStreamList
          items={queue.items}
          loading={queue.loading}
        />
      </main>
    </div>
  )
}
