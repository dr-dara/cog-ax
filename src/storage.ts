import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy } from 'firebase/firestore'
import type { TestResult, SaveState } from './types'

const PENDING_KEY = 'pendingUploads'
const RESULTS_KEY = 'resultsCache'
const PARTICIPANT_KEY = 'participantId'

let firestoreDb: ReturnType<typeof getFirestore> | null = null
let firebaseReady = false

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const hasFirebaseConfig = () => Object.values(firebaseConfig).every((value) => Boolean(value))

export const initFirebase = () => {
  if (firebaseReady || !hasFirebaseConfig()) {
    return
  }

  const app = initializeApp(firebaseConfig)
  firestoreDb = getFirestore(app)
  firebaseReady = true
}

export const saveParticipantId = (participantId: string) => {
  localStorage.setItem(PARTICIPANT_KEY, participantId)
}

export const loadParticipantId = () => localStorage.getItem(PARTICIPANT_KEY)

export const cacheResult = (result: TestResult) => {
  const results = loadCachedResults()
  results.push(result)
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results))
}

export const loadCachedResults = (): TestResult[] => {
  const raw = localStorage.getItem(RESULTS_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as TestResult[]
  } catch {
    return []
  }
}

export const getCachedResultsForParticipant = (participantId: string) =>
  loadCachedResults().filter((result) => result.participant_id === participantId)

const addPendingUpload = (result: TestResult) => {
  const pending = loadPendingUploads()
  pending.push(result)
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

const loadPendingUploads = (): TestResult[] => {
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as TestResult[]
  } catch {
    return []
  }
}

const setPendingUploads = (pending: TestResult[]) => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

export const saveResult = async (result: TestResult): Promise<SaveState> => {
  cacheResult(result)

  if (!firestoreDb) {
    addPendingUpload(result)
    return {
      status: 'queued',
      message: 'Saved locally. Firebase is not configured in this build.',
    }
  }

  try {
    await addDoc(collection(firestoreDb, 'results'), result)
    return {
      status: 'saved',
      message: 'Saved to the cloud.',
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown error'
    addPendingUpload(result)
    return {
      status: 'queued',
      message: `Saved locally. Cloud sync failed (${reason}).`,
    }
  }
}

export const retryPendingUploads = async () => {
  if (!firestoreDb) return

  const pending = loadPendingUploads()
  if (!pending.length) return

  const remaining: TestResult[] = []
  for (const result of pending) {
    try {
      await addDoc(collection(firestoreDb, 'results'), result)
    } catch {
      remaining.push(result)
    }
  }

  setPendingUploads(remaining)
}

export const getRemoteResults = async (participantId: string): Promise<TestResult[]> => {
  if (!firestoreDb) return []

  try {
    const q = query(
      collection(firestoreDb, 'results'),
      where('participant_id', '==', participantId),
      orderBy('timestamp', 'asc')
    )
    const snapshot = await getDocs(q)
    return snapshot.docs.map((doc) => doc.data() as TestResult)
  } catch {
    return []
  }
}
