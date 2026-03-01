import { useState, useMemo } from 'react'
import styles from './DataTable.module.scss'

export interface Column<T> {
  key: string
  header: string
  width?: number
  render: (item: T) => React.ReactNode
  sortable?: boolean
  sortValue?: (item: T) => string | number
}

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (item: T) => string
  onRowClick?: (item: T) => void
  emptyMessage?: string
  stickyHeader?: boolean
}

type SortState = {
  key: string
  direction: 'asc' | 'desc'
} | null

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'No data',
  stickyHeader = false,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(null)

  const sorted = useMemo(() => {
    if (!sort) return data
    const col = columns.find(c => c.key === sort.key)
    if (!col?.sortValue) return data
    return [...data].sort((a, b) => {
      const aVal = col.sortValue!(a)
      const bVal = col.sortValue!(b)
      if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1
      return 0
    })
  }, [data, sort, columns])

  function handleSort(key: string) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, direction: 'asc' }
      if (prev.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  return (
    <div className={styles.Wrapper}>
      <table className={styles.Table}>
        <thead className={stickyHeader ? styles.Sticky : ''}>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={`${styles.Th} ${col.sortable ? styles.Sortable : ''}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                {col.header}
                {sort?.key === col.key && (
                  <span className={styles.SortArrow}>
                    {sort.direction === 'asc' ? '\u2191' : '\u2193'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.Empty}>{emptyMessage}</td>
            </tr>
          ) : (
            sorted.map(item => (
              <tr
                key={keyExtractor(item)}
                className={`${styles.Row} ${onRowClick ? styles.Clickable : ''}`}
                onClick={onRowClick ? () => onRowClick(item) : undefined}
              >
                {columns.map(col => (
                  <td key={col.key} className={styles.Td}>
                    {col.render(item)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
