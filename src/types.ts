export type TestName = 'digit-span' | 'stroop' | 'corsi' | 'srt'

export interface TestResult {
  participant_id: string
  session: number
  test: TestName
  score: number
  timestamp: string
  metrics: Record<string, unknown>
}

export interface SaveState {
  status: 'saved' | 'queued' | 'failed'
  message: string
}

export interface TestContext {
  participantId: string
  session: number
  onSave: (result: TestResult) => Promise<SaveState>
  onExit: () => void
}
