const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null

export function playNotificationSound(type: 'success' | 'error' | 'info') {
  if (!audioCtx) return

  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)

  const now = audioCtx.currentTime
  gain.gain.setValueAtTime(0.08, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

  if (type === 'success') {
    osc.frequency.setValueAtTime(523, now)      // C5
    osc.frequency.setValueAtTime(659, now + 0.08) // E5
  } else if (type === 'error') {
    osc.frequency.setValueAtTime(330, now)      // E4
    osc.frequency.setValueAtTime(262, now + 0.08) // C4
  } else {
    osc.frequency.setValueAtTime(440, now)      // A4
  }

  osc.type = 'sine'
  osc.start(now)
  osc.stop(now + 0.2)
}
