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
  resultsViewParticipantId: '',
  lastSaveState: null as SaveState | null,
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
  const statusLabel = state.lastSaveState
    ? state.lastSaveState.status === 'saved'
      ? 'Synced'
      : state.lastSaveState.status === 'queued'
        ? 'Saved locally'
        : 'Save failed'
    : 'No sync yet'
  const statusClass = state.lastSaveState
    ? state.lastSaveState.status === 'saved'
      ? 'bg-emerald-100 text-emerald-800'
      : state.lastSaveState.status === 'queued'
        ? 'bg-amber-100 text-amber-900'
        : 'bg-rose-100 text-rose-900'
    : 'bg-slate-100 text-slate-700'

  app.innerHTML = `
    <div class="min-h-screen bg-slate-50 text-slate-900">
      <div class="max-w-5xl mx-auto px-6 py-10">
        <div class="flex flex-col items-end gap-2 mb-4">
          <span class="px-3 py-2 rounded-full text-sm font-semibold ${statusClass}">${statusLabel}</span>
          ${state.lastSaveState ? `<span class="text-sm hint max-w-md text-right">${state.lastSaveState.message}</span>` : ''}
        </div>
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
          <div class="flex flex-col md:flex-row gap-3">
            <button id="view-results" class="btn-secondary rounded-xl px-6 py-3 text-lg">View Results</button>
            <button id="change-id" class="btn-secondary rounded-xl px-6 py-3 text-lg">Change Participant ID</button>
          </div>
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

  app.querySelector<HTMLButtonElement>('#view-results')?.addEventListener('click', () => {
    state.resultsViewParticipantId = state.participantId
    renderResultsDashboard()
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

const renderResultsDashboard = () => {
  const participantOptions = Array.from(new Set(state.results.map((result) => result.participant_id))).sort()
  const selectedParticipant = state.resultsViewParticipantId || state.participantId
  const filtered = state.results
    .filter((result) => result.participant_id === selectedParticipant)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const groupedByTest = filtered.reduce<Record<TestName, TestResult[]>>((acc, result) => {
    acc[result.test] = acc[result.test] ?? []
    acc[result.test].push(result)
    return acc
  }, { 'digit-span': [], stroop: [], corsi: [], srt: [] })

  const resultRows =
    filtered.length === 0
      ? `<p class="hint">No results found for this participant yet.</p>`
      : `
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-200">
                <th class="py-2">Session</th>
                <th class="py-2">Test</th>
                <th class="py-2">Score</th>
                <th class="py-2">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${filtered
                .map(
                  (result) => `
                    <tr class="border-b border-slate-100">
                      <td class="py-2">${result.session}</td>
                      <td class="py-2">${result.test}</td>
                      <td class="py-2">${result.score}</td>
                      <td class="py-2">${formatDate(result.timestamp)}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `

  const chartCard = (test: TestName, entries: TestResult[]) => {
    if (!entries.length) {
      return `
        <div class="border border-slate-200 rounded-xl p-4">
          <p class="text-lg font-semibold mb-2">${test}</p>
          <p class="hint">No entries yet.</p>
        </div>
      `
    }

    const sorted = [...entries].sort((a, b) => a.session - b.session)
    const scores = sorted.map((entry) => entry.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const range = max - min || 1
    const width = 320
    const height = 140
    const padding = 24
    const points = sorted
      .map((entry, index) => {
        const x =
          padding +
          (sorted.length === 1 ? 0 : (index / (sorted.length - 1)) * (width - padding * 2))
        const y = padding + (1 - (entry.score - min) / range) * (height - padding * 2)
        return `${x},${y}`
      })
      .join(' ')

    return `
      <div class="border border-slate-200 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <p class="text-lg font-semibold">${test}</p>
          <span class="hint">Min ${min} · Max ${max}</span>
        </div>
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="w-full">
          <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#f8fafc"></rect>
          <polyline
            fill="none"
            stroke="#2563eb"
            stroke-width="3"
            points="${points}"
          ></polyline>
          ${sorted
            .map((entry, index) => {
              const x =
                padding +
                (sorted.length === 1 ? 0 : (index / (sorted.length - 1)) * (width - padding * 2))
              const y = padding + (1 - (entry.score - min) / range) * (height - padding * 2)
              return `<circle cx="${x}" cy="${y}" r="4" fill="#1d4ed8"></circle>`
            })
            .join('')}
        </svg>
        <div class="grid gap-2 mt-4">
          ${sorted
            .map(
              (entry) => `
                <div class="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
                  <span>Session ${entry.session}</span>
                  <span class="font-semibold">${entry.score}</span>
                  <span class="hint">${formatDate(entry.timestamp)}</span>
                </div>
              `
            )
            .join('')}
        </div>
      </div>
    `
  }

  const timelineCards = (Object.keys(groupedByTest) as TestName[])
    .map((test) => chartCard(test, groupedByTest[test]))
    .join('')

  renderShell(`
    <div class="card p-10 mb-8">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold mb-2">Results Dashboard</h1>
          <p class="hint">Review results by participant and over time.</p>
        </div>
        <button id="back-dashboard" class="btn-secondary rounded-xl px-6 py-3 text-lg">Back to Dashboard</button>
      </div>
    </div>

    <div class="card p-6 mb-6">
      <h2 class="text-2xl font-semibold mb-4">Participant</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="block mb-2 text-lg">Known participants</label>
          <select id="participant-select" class="input-field">
            ${participantOptions
              .map(
                (id) => `<option value="${id}" ${id === selectedParticipant ? 'selected' : ''}>${id}</option>`
              )
              .join('')}
          </select>
        </div>
        <div>
          <label class="block mb-2 text-lg">Or enter a participant ID</label>
          <input id="participant-input" class="input-field" placeholder="Example: P001" value="${selectedParticipant}" />
        </div>
        <div class="flex items-end">
          <button id="load-participant" class="btn-primary rounded-xl px-6 py-4 text-lg w-full">Load Results</button>
        </div>
      </div>
      <p class="hint mt-4">Loading another participant will fetch their data from Firebase if available.</p>
    </div>

    <div class="card p-6 mb-6">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <h2 class="text-2xl font-semibold">All Results</h2>
        <div class="flex flex-col md:flex-row gap-3">
          <button id="export-current" class="btn-secondary rounded-xl px-6 py-3 text-lg">Export CSV (Participant)</button>
          <button id="export-all" class="btn-secondary rounded-xl px-6 py-3 text-lg">Export CSV (All)</button>
        </div>
      </div>
      ${resultRows}
    </div>

    <div class="grid md:grid-cols-2 gap-6">
      ${timelineCards}
    </div>
  `)

  app.querySelector<HTMLButtonElement>('#back-dashboard')?.addEventListener('click', () => renderDashboard())

  app.querySelector<HTMLSelectElement>('#participant-select')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    state.resultsViewParticipantId = value
    renderResultsDashboard()
  })

  app.querySelector<HTMLButtonElement>('#load-participant')?.addEventListener('click', async () => {
    const input = app.querySelector<HTMLInputElement>('#participant-input')
    const value = input?.value.trim()
    if (!value) {
      input?.focus()
      return
    }
    state.resultsViewParticipantId = value
    await loadResultsForParticipant(value)
    renderResultsDashboard()
  })

  app.querySelector<HTMLButtonElement>('#export-current')?.addEventListener('click', () => {
    downloadCsv(`${selectedParticipant}-results.csv`, filtered)
  })

  app.querySelector<HTMLButtonElement>('#export-all')?.addEventListener('click', () => {
    downloadCsv('all-results.csv', state.results)
  })
}

const downloadCsv = (filename: string, results: TestResult[]) => {
  if (!results.length) return
  const headers = ['participant_id', 'session', 'test', 'score', 'timestamp', 'metrics']
  const rows = results.map((result) => [
    result.participant_id,
    result.session,
    result.test,
    result.score,
    result.timestamp,
    JSON.stringify(result.metrics ?? {}),
  ])

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const stringValue = String(value ?? '')
          const escaped = stringValue.replace(/"/g, '""')
          return `"${escaped}"`
        })
        .join(',')
    )
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const loadResultsForParticipant = async (participantId: string) => {
  const cached = getCachedResultsForParticipant(participantId)
  mergeResults(cached)

  if (hasFirebaseConfig()) {
    const remote = await getRemoteResults(participantId)
    mergeResults(remote)
  }
}

const startTest = (testName: TestName) => {
  const context = {
    participantId: state.participantId,
    session: state.session,
    onSave: async (result: TestResult): Promise<SaveState> => {
      const saveState = await saveResult(result)
      mergeResults([result])
      state.lastSaveState = saveState
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
  await loadResultsForParticipant(state.participantId)
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
