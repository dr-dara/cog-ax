import type { TestContext, TestResult } from '../types'
import { formatMs } from './utils'

export const renderSRT = (container: HTMLElement, ctx: TestContext) => {
  let cancelled = false
  const state = {
    trials: 5,
    reactionTimes: [] as number[],
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
      <h1 class="text-3xl font-semibold mb-4">Simple Reaction Time</h1>
      <p class="mb-4">A green circle will appear after a short wait. Click it or press the spacebar as quickly as you can.</p>
      <p class="mb-6">There are 5 trials.</p>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-practice" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Practice</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#start-practice')?.addEventListener('click', () => runPractice())
    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runPractice = async () => {
    await runTrial(true, 1, 1)
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
    for (let i = 0; i < state.trials; i += 1) {
      const rt = await runTrial(false, i + 1, state.trials)
      if (cancelled) return
      state.reactionTimes.push(rt)
    }

    const average =
      state.reactionTimes.reduce((sum, value) => sum + value, 0) / state.reactionTimes.length

    const result: TestResult = {
      participant_id: ctx.participantId,
      session: ctx.session,
      test: 'srt',
      score: Math.round(average),
      timestamp: new Date().toISOString(),
      metrics: {
        averageReactionTimeMs: Math.round(average),
        trials: state.trials,
      },
    }

    const saveState = await ctx.onSave(result)
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Test complete</h2>
      <p class="mb-2">Average reaction time: <strong>${formatMs(average)}</strong></p>
      <p class="mb-6 hint">${saveState.message}</p>
      <button id="exit-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Back to Session</button>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runTrial = async (isPractice: boolean, index: number, total: number) => {
    let early = true
    while (early) {
      early = false
      renderShell(`
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-semibold">${isPractice ? 'Practice' : 'Trial'} ${index} of ${total}</h2>
          <button id="exit-test" class="btn-secondary rounded-xl px-5 py-3 text-lg">Back to Session</button>
        </div>
        <p class="mb-6">Wait for the green circle.</p>
        <div class="flex items-center justify-center h-64">
          <div id="signal" class="w-36 h-36 rounded-full srt-wait"></div>
        </div>
      `)

      container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', (event) => {
        event.stopPropagation()
        handleExit()
      })

      const delay = 2000 + Math.random() * 3000
      const signal = container.querySelector<HTMLDivElement>('#signal')
      let startTime = 0
      let ready = false

      const response = await new Promise<number | 'early'>((resolve) => {
        const cleanup = () => {
          clearTimeout(timeout)
          signal?.removeEventListener('click', handleClick)
          window.removeEventListener('keydown', handleKey)
        }

        const finalize = (value: number | 'early') => {
          cleanup()
          resolve(value)
        }

        const handleClick = () => {
          if (!ready) {
            finalize('early')
            return
          }
          finalize(performance.now() - startTime)
        }

        const handleKey = (event: KeyboardEvent) => {
          if (event.code === 'Space') {
            handleClick()
          }
        }

        const timeout = setTimeout(() => {
          ready = true
          signal?.classList.remove('srt-wait')
          signal?.classList.add('srt-ready')
          startTime = performance.now()
        }, delay)

        signal?.addEventListener('click', handleClick)
        window.addEventListener('keydown', handleKey)
      })

      if (response === 'early') {
        renderShell(`
          <h2 class="text-2xl font-semibold mb-2">Too soon</h2>
          <p class="mb-4">Please wait for the green circle before clicking.</p>
          <button id="retry" class="btn-primary rounded-xl px-6 py-4 text-lg">Try again</button>
        `)
        await new Promise<void>((resolve) => {
          container.querySelector<HTMLButtonElement>('#retry')?.addEventListener('click', () => resolve())
        })
        early = true
      } else {
        return response
      }
    }

    return 0
  }

  renderInstructions()
}
