import './style.css'
import { renderBackwardDigitSpan } from './tests/backwardDigitSpan'
import { renderStroop } from './tests/stroop'
import { renderCorsi } from './tests/corsi'
import { renderSRT } from './tests/srt'
import type { TestName, TestResult, SaveState } from './types'
import {
  initFirebase,
  hasFirebaseConfig,
  saveParticipantId,
  loadParticipantId,
  getRemoteResults,
  getCachedResultsForParticipant,
  saveResult,
  retryPendingUploads,
} from './storage'

type SessionSummary = {
  session: number
  completedAt?: string
  tests: Partial<Record<TestName, TestResult>>
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app element')
}

const state = {
  participantId: loadParticipantId() ?? '',
  session: 1,
  results: [] as TestResult[],
}

initFirebase()
retryPendingUploads()
window.addEventListener('online', () => retryPendingUploads())

const mergeResults = (results: TestResult[]) => {
  const existing = new Map(
    state.results.map((item) => [`${item.participant_id}|${item.session}|${item.test}|${item.timestamp}`, item])
  )
  results.forEach((item) => {
    const key = `${item.participant_id}|${item.session}|${item.test}|${item.timestamp}`
    if (!existing.has(key)) {
      state.results.push(item)
      existing.set(key, item)
    }
  })
}

const REQUIRED_TESTS: TestName[] = ['digit-span', 'stroop', 'corsi', 'srt']

const buildSessionSummaries = (): SessionSummary[] => {
  const summaries = new Map<number, SessionSummary>()
  state.results
    .filter((result) => result.participant_id === state.participantId)
    .forEach((result) => {
      if (!summaries.has(result.session)) {
        summaries.set(result.session, {
          session: result.session,
          tests: {},
        })
      }
      const summary = summaries.get(result.session)
      if (summary) {
        summary.tests[result.test] = result
        if (!summary.completedAt || result.timestamp > summary.completedAt) {
          summary.completedAt = result.timestamp
        }
      }
    })

  return Array.from(summaries.values()).sort((a, b) => a.session - b.session)
}

const isSessionComplete = (summary: SessionSummary) =>
  REQUIRED_TESTS.every((test) => Boolean(summary.tests[test]))

const getNextSessionNumber = () => {
  const summaries = buildSessionSummaries()
  if (!summaries.length) return 1
  const maxSession = Math.max(...summaries.map((summary) => summary.session))
  const latest = summaries.find((summary) => summary.session === maxSession)
  if (latest && !isSessionComplete(latest)) {
    return maxSession
  }
  return maxSession + 1
}

const formatDate = (iso?: string) => {
  if (!iso) return 'Not completed yet'
  const date = new Date(iso)
  return date.toLocaleDateString()
}

const renderShell = (content: string) => {
  app.innerHTML = `
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <div class="max-w-5xl mx-auto px-6 py-10">
        ${content}
      </div>
    </div>
  `
}

const renderLanding = () => {
  renderShell(`
    <div class="card p-10">
      <h1 class="text-3xl font-semibold mb-3">Cognitive Assessment</h1>
      <p class="mb-6">Enter the participant ID provided by your researcher. No email or password is required.</p>
      <label for="participant" class="block mb-2 text-lg">Participant ID</label>
      <input id="participant" class="input-field mb-4" placeholder="Example: P001" value="${state.participantId}" />
      <div class="flex flex-col md:flex-row gap-4">
        <button id="continue" class="btn-primary rounded-xl px-6 py-4 text-lg">Continue</button>
      </div>
      <p class="mt-6 hint">${hasFirebaseConfig() ? 'Cloud sync is ready.' : 'Cloud sync is not configured yet. Results will be saved locally.'}</p>
    </div>
  `)

  app.querySelector<HTMLButtonElement>('#continue')?.addEventListener('click', async () => {
    const input = app.querySelector<HTMLInputElement>('#participant')
    const participantId = input?.value.trim()
    if (!participantId) {
      input?.focus()
      return
    }
    state.participantId = participantId
    saveParticipantId(participantId)
    await loadResults()
    renderDashboard()
  })
}

const renderDashboard = () => {
  const summaries = buildSessionSummaries()
  const nextSession = getNextSessionNumber()
  const summaryMarkup =
    summaries.length > 0
      ? summaries
          .map(
            (summary) => `
              <div class="border border-slate-200 rounded-xl p-4">
                <p class="text-lg font-semibold">Session ${summary.session}</p>
                <p class="hint">${isSessionComplete(summary) ? 'Completed' : 'In progress'} · ${formatDate(summary.completedAt)}</p>
                <button data-session="${summary.session}" class="btn-secondary rounded-xl px-4 py-3 text-lg mt-3">Open Session</button>
              </div>
            `
          )
          .join('')
      : `<p class="hint">No sessions completed yet.</p>`

  renderShell(`
    <div class="card p-10 mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold mb-2">Welcome, ${state.participantId}</h1>
          <p class="hint">Choose a session to begin or continue.</p>
        </div>
        <button id="change-id" class="btn-secondary rounded-xl px-6 py-3 text-lg">Change Participant ID</button>
      </div>
    </div>
    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <div class="card p-6">
        <h2 class="text-2xl font-semibold mb-4">Sessions</h2>
        <div class="grid gap-3 mb-6">
          ${summaryMarkup}
        </div>
        <button id="start-next" class="btn-primary rounded-xl px-6 py-4 text-lg w-full">Start Session ${nextSession}</button>
      </div>
      <div class="card p-6">
        <h2 class="text-2xl font-semibold mb-4">What happens next?</h2>
        <ul class="list-disc pl-6">
          <li>Each session includes four short tests.</li>
          <li>You will see instructions and a practice round before each test.</li>
          <li>Results are saved automatically.</li>
        </ul>
      </div>
    </div>
  `)

  app.querySelector<HTMLButtonElement>('#change-id')?.addEventListener('click', () => {
    state.participantId = ''
    renderLanding()
  })

  app.querySelectorAll<HTMLButtonElement>('button[data-session]').forEach((button) => {
    button.addEventListener('click', () => {
      const session = Number(button.dataset.session)
      state.session = session
      renderSession()
    })
  })

  app.querySelector<HTMLButtonElement>('#start-next')?.addEventListener('click', () => {
    state.session = nextSession
    renderSession()
  })
}

const renderSession = () => {
  const tests: { name: TestName; label: string; description: string }[] = [
    { name: 'digit-span', label: 'Backward Digit Span', description: 'Working memory' },
    { name: 'stroop', label: 'Stroop Color-Word', description: 'Inhibition and processing speed' },
    { name: 'corsi', label: 'Corsi Block-Tapping', description: 'Visual-spatial memory' },
    { name: 'srt', label: 'Simple Reaction Time', description: 'Processing speed' },
  ]

  const completed = buildSessionSummaries().find((summary) => summary.session === state.session)

  renderShell(`
    <div class="card p-10 mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold mb-2">Session ${state.session}</h1>
          <p class="hint">Participant ${state.participantId}</p>
        </div>
        <button id="back-dashboard" class="btn-secondary rounded-xl px-6 py-3 text-lg">Back to Dashboard</button>
      </div>
    </div>
    <div class="grid md:grid-cols-2 gap-6">
      ${tests
        .map((test) => {
          const finished = completed?.tests[test.name]
          return `
            <div class="card p-6 flex flex-col gap-3">
              <h2 class="text-2xl font-semibold">${test.label}</h2>
              <p class="hint">${test.description}</p>
              <p class="hint">${finished ? `Completed on ${formatDate(finished.timestamp)}` : 'Not completed yet'}</p>
              <button data-test="${test.name}" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Test</button>
            </div>
          `
        })
        .join('')}
    </div>
  `)

  app.querySelector<HTMLButtonElement>('#back-dashboard')?.addEventListener('click', () => renderDashboard())
  app.querySelectorAll<HTMLButtonElement>('button[data-test]').forEach((button) => {
    button.addEventListener('click', () => {
      const testName = button.dataset.test as TestName
      startTest(testName)
    })
  })
}

const startTest = (testName: TestName) => {
  const context = {
    participantId: state.participantId,
    session: state.session,
    onSave: async (result: TestResult): Promise<SaveState> => {
      const saveState = await saveResult(result)
      mergeResults([result])
      return saveState
    },
    onExit: () => renderSession(),
  }

  if (testName === 'digit-span') {
    renderBackwardDigitSpan(app, context)
  } else if (testName === 'stroop') {
    renderStroop(app, context)
  } else if (testName === 'corsi') {
    renderCorsi(app, context)
  } else {
    renderSRT(app, context)
  }
}

const loadResults = async () => {
  const cached = getCachedResultsForParticipant(state.participantId)
  mergeResults(cached)

  if (hasFirebaseConfig()) {
    const remote = await getRemoteResults(state.participantId)
    mergeResults(remote)
  }
}

const startApp = async () => {
  if (state.participantId) {
    await loadResults()
    renderDashboard()
  } else {
    renderLanding()
  }
}

startApp()
