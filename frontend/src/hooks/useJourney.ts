import { useSyncExternalStore } from 'react'
import { guardian } from '../services/telemetry'

export function useJourney() { return useSyncExternalStore(guardian.subscribe, guardian.snapshot) }
