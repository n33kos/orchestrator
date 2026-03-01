import styles from './Skeleton.module.scss'

interface SkeletonCardProps {
  count?: number
}

function SkeletonCard() {
  return (
    <div className={styles.Card}>
      <div className={styles.CardHeader}>
        <div className={styles.CardTitleRow}>
          <div className={styles.Bone} style={{ width: 24, height: 14 }} />
          <div className={styles.Bone} style={{ width: '60%', height: 16 }} />
        </div>
        <div className={styles.Bone} style={{ width: 64, height: 22, borderRadius: 100 }} />
      </div>
      <div className={styles.Bone} style={{ width: '85%', height: 12, marginTop: 8 }} />
      <div className={styles.CardMeta}>
        <div className={styles.Bone} style={{ width: 120, height: 12 }} />
        <div className={styles.Bone} style={{ width: 48, height: 12 }} />
        <div className={styles.Bone} style={{ width: 64, height: 22 }} />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 4 }: SkeletonCardProps) {
  return (
    <div className={styles.Root}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
