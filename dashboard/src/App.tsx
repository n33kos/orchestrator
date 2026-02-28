import styles from './App.module.scss'
import { Header } from './components/Header/Header.tsx'
import { WorkStreamList } from './components/WorkStreamList/WorkStreamList.tsx'

export function App() {
  return (
    <div className={styles.Root}>
      <Header />
      <main className={styles.Main}>
        <WorkStreamList />
      </main>
    </div>
  )
}
