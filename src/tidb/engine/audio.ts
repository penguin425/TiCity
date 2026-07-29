/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Audio is opt-in. Oscillators are persistent after enable(), so the animation
 * path only adjusts AudioParams and never creates a node per trace event.
 */

export interface CityAudio {
  readonly enabled: boolean
  enable(): Promise<boolean>
  update(activity: Float32Array): void
  setMuted(muted: boolean): void
  dispose(): void
}
const FREQUENCIES = new Float32Array([165, 220, 294, 349, 196, 247, 392, 523])

export function createCityAudio(): CityAudio {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let oscillators: OscillatorNode[] = []
  let gains: GainNode[] = []
  let muted = false

  async function enable(): Promise<boolean> {
    if (context) {
      if (context.state === 'suspended') await context.resume()
      return true
    }
    if (typeof window === 'undefined') return false
    const AudioContextClass = (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).AudioContext ?? (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext
    if (!AudioContextClass) return false

    context = new AudioContextClass()
    master = context.createGain()
    master.gain.value = muted ? 0 : 0.16
    master.connect(context.destination)
    oscillators = new Array<OscillatorNode>(FREQUENCIES.length)
    gains = new Array<GainNode>(FREQUENCIES.length)
    for (let i = 0; i < FREQUENCIES.length; i++) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = i === 4 ? 'triangle' : 'sine'
      oscillator.frequency.value = FREQUENCIES[i]
      gain.gain.value = 0
      oscillator.connect(gain)
      gain.connect(master)
      oscillator.start()
      oscillators[i] = oscillator
      gains[i] = gain
    }
    if (context.state === 'suspended') await context.resume()
    return true
  }

  return {
    get enabled(): boolean {
      return context !== null
    },
    enable,
    update(activity: Float32Array): void {
      if (!context) return
      const now = context.currentTime
      const count = Math.min(gains.length, activity.length)
      for (let i = 0; i < count; i++) {
        const level = Math.min(0.035, activity[i] * 0.0045)
        gains[i].gain.setTargetAtTime(level, now, level > 0 ? 0.025 : 0.09)
      }
    },
    setMuted(next: boolean): void {
      muted = next
      if (context && master) {
        master.gain.setTargetAtTime(muted ? 0 : 0.16, context.currentTime, 0.04)
      }
    },
    dispose(): void {
      for (let i = 0; i < oscillators.length; i++) {
        oscillators[i].stop()
        oscillators[i].disconnect()
        gains[i].disconnect()
      }
      oscillators = []
      gains = []
      master?.disconnect()
      master = null
      if (context) void context.close()
      context = null
    },
  }
}
