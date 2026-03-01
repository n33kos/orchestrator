import { useState } from 'react'
import styles from './App.module.scss'
import { Header } from './components/Header/Header.tsx'
import { TabBar } from './components/TabBar/TabBar.tsx'
import { WorkStreamList } from './components/WorkStreamList/WorkStreamList.tsx'
import { useQueue } from './hooks/useQueue.ts'

export function App() {
  const queue = useQueue()
  const [activeTab, setActiveTab] = useState('projects')

  const tabs = [
    { id: 'projects', label: 'Projects', count: queue.projects.length },
    { id: 'quick_fixes', label: 'Quick Fixes', count: queue.quickFixes.length },
    { id: 'all', label: 'All', count: queue.items.length },
  ]

  const displayItems = activeTab === 'projects'
    ? queue.projects
    : activeTab === 'quick_fixes'
      ? queue.quickFixes
      : queue.items

  return (
    <div className={styles.Root}>
      <Header
        activeCount={queue.activeItems.length}
        queuedCount={queue.queuedItems.length}
        pausedCount={queue.pausedItems.length}
        blockedCount={queue.blockedItems.length}
      />
      <main className={styles.Main}>
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        <WorkStreamList
          items={displayItems}
          loading={queue.loading}
        />
      </main>
    </div>
  )
}
