import type { TestContext, TestResult } from '../types'
import { shuffle, formatMs } from './utils'

type Color = {
  name: string
  className: string
}

const COLORS: Color[] = [
  { name: 'Red', className: 'stroop-red' },
  { name: 'Blue', className: 'stroop-blue' },
  { name: 'Green', className: 'stroop-green' },
  { name: 'Yellow', className: 'stroop-yellow' },
]

const createTrial = () => {
  const ink = COLORS[Math.floor(Math.random() * COLORS.length)]
  const congruent = Math.random() < 0.5
  let word = ink

  if (!congruent) {
    const options = COLORS.filter((color) => color.name !== ink.name)
    word = options[Math.floor(Math.random() * options.length)]
  }

  return { ink, word, congruent }
}

export const renderStroop = (container: HTMLElement, ctx: TestContext) => {
  let cancelled = false
  const state = {
    trials: 30,
    accuracy: 0,
    congruentTimes: [] as number[],
    incongruentTimes: [] as number[],
  }

  const handleExit = () => {
    cancelled = true
    ctx.onExit()
  }

  const renderShell = (content: string) => {
    container.innerHTML = `
      <div class="min-h-screen bg-slate-50 text-slate-900">
        <div class="max-w-4xl mx-auto px-6 py-10">
          <div class="card p-8">
            ${content}
          </div>
        </div>
      </div>
    `
  }

  const renderInstructions = () => {
    renderShell(`
      <h1 class="text-3xl font-semibold mb-4">Stroop Color-Word Test</h1>
      <p class="mb-4">You will see a word printed in a color. Click the button that matches the <strong>ink color</strong>, not the word.</p>
      <p class="mb-6">There are 30 trials. Try to respond as quickly and accurately as you can.</p>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-practice" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Practice</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#start-practice')?.addEventListener('click', () => runPractice())
    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runPractice = async () => {
    await runTrials(5, true)
    if (cancelled) return
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Practice complete</h2>
      <p class="mb-6">Ready for the full test?</p>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Test</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#start-test')?.addEventListener('click', () => runTest())
    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runTest = async () => {
    await runTrials(state.trials, false)
    if (cancelled) return

    const accuracyPercent = Math.round((state.accuracy / state.trials) * 100)
    const average = (values: number[]) =>
      values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0

    const result: TestResult = {
      participant_id: ctx.participantId,
      session: ctx.session,
      test: 'stroop',
      score: accuracyPercent,
      timestamp: new Date().toISOString(),
      metrics: {
        accuracy: accuracyPercent,
        congruentAverageMs: average(state.congruentTimes),
        incongruentAverageMs: average(state.incongruentTimes),
        congruentTrials: state.congruentTimes.length,
        incongruentTrials: state.incongruentTimes.length,
      },
    }

    const saveState = await ctx.onSave(result)
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Test complete</h2>
      <p class="mb-2">Accuracy: <strong>${accuracyPercent}%</strong></p>
      <p class="mb-2">Average congruent reaction time: <strong>${formatMs(result.metrics.congruentAverageMs as number)}</strong></p>
      <p class="mb-4">Average incongruent reaction time: <strong>${formatMs(result.metrics.incongruentAverageMs as number)}</strong></p>
      <p class="mb-6 hint">${saveState.message}</p>
      <button id="exit-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Back to Session</button>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runTrials = async (count: number, isPractice: boolean) => {
    for (let i = 0; i < count; i += 1) {
      const trial = createTrial()
      const result = await runTrial(trial, isPractice, i + 1, count)
      if (cancelled) return
      if (!isPractice) {
        if (result.correct) {
          state.accuracy += 1
        }
        if (result.congruent) {
          state.congruentTimes.push(result.reactionTime)
        } else {
          state.incongruentTimes.push(result.reactionTime)
        }
      }
    }
  }

  const runTrial = async (
    trial: { ink: Color; word: Color; congruent: boolean },
    isPractice: boolean,
    index: number,
    total: number
  ) => {
    const buttonsMarkup = shuffle(COLORS)
      .map(
        (color) => `
          <button data-color="${color.name}" class="btn-secondary rounded-xl px-6 py-4 text-lg">${color.name}</button>
        `
      )
      .join('')

    renderShell(`
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold">${isPractice ? 'Practice' : 'Trial'} ${index} of ${total}</h2>
        <button id="exit-test" class="btn-secondary rounded-xl px-5 py-3 text-lg">Back to Session</button>
      </div>
      <div class="text-center mb-8">
        <div class="text-5xl font-bold tracking-widest ${trial.ink.className}">${trial.word.name.toUpperCase()}</div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        ${buttonsMarkup}
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())

    const startTime = performance.now()
    const response = await new Promise<string>((resolve) => {
      container.querySelectorAll<HTMLButtonElement>('button[data-color]').forEach((button) => {
        button.addEventListener('click', () => resolve(button.dataset.color || ''))
      })
    })

    const reactionTime = performance.now() - startTime
    const correct = response === trial.ink.name

    renderShell(`
      <h2 class="text-2xl font-semibold mb-2">${correct ? 'Correct' : 'Incorrect'}</h2>
      <p class="mb-4">${correct ? 'Great job.' : `The ink color was ${trial.ink.name}.`}</p>
      <button id="next" class="btn-primary rounded-xl px-6 py-4 text-lg">Continue</button>
    `)

    await new Promise<void>((resolve) => {
      container.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => resolve())
    })

    return {
      congruent: trial.congruent,
      correct,
      reactionTime,
    }
  }

  renderInstructions()
}
