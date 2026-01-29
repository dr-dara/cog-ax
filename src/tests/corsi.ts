import type { TestContext, TestResult } from '../types'
import { wait } from './utils'

const createSequence = (length: number) => {
  const sequence: number[] = []
  while (sequence.length < length) {
    const next = Math.floor(Math.random() * 9)
    if (sequence.length < 9 && sequence.includes(next)) continue
    sequence.push(next)
  }
  return sequence
}

export const renderCorsi = (container: HTMLElement, ctx: TestContext) => {
  let cancelled = false
  const state = {
    currentLength: 2,
    maxSpan: 1,
    consecutiveErrors: 0,
    totalRounds: 0,
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
      <h1 class="text-3xl font-semibold mb-4">Corsi Block-Tapping</h1>
      <p class="mb-4">Watch the blocks light up in a sequence. Then tap the blocks in the same order.</p>
      <p class="mb-6">The sequence gets longer after each correct round.</p>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-practice" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Practice</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#start-practice')?.addEventListener('click', () => runPractice())
    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runPractice = async () => {
    await runRound(2, true)
    if (cancelled) return
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Practice complete</h2>
      <p class="mb-6">Ready for the real test?</p>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Test</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    container.querySelector<HTMLButtonElement>('#start-test')?.addEventListener('click', () => runTest())
    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runTest = async () => {
    while (state.consecutiveErrors < 2) {
      const correct = await runRound(state.currentLength, false)
      if (cancelled) return
      state.totalRounds += 1

      if (correct) {
        state.maxSpan = Math.max(state.maxSpan, state.currentLength)
        state.currentLength += 1
        state.consecutiveErrors = 0
      } else {
        state.consecutiveErrors += 1
      }
    }

    const result: TestResult = {
      participant_id: ctx.participantId,
      session: ctx.session,
      test: 'corsi',
      score: state.maxSpan,
      timestamp: new Date().toISOString(),
      metrics: {
        maxSpan: state.maxSpan,
        totalRounds: state.totalRounds,
      },
    }

    const saveState = await ctx.onSave(result)
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Test complete</h2>
      <p class="mb-2">Maximum span reached: <strong>${state.maxSpan}</strong></p>
      <p class="mb-6 hint">${saveState.message}</p>
      <button id="exit-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Back to Session</button>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runRound = async (length: number, isPractice: boolean) => {
    const sequence = createSequence(length)

    renderShell(`
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold">${isPractice ? 'Practice' : `Sequence length ${length}`}</h2>
        <button id="exit-test" class="btn-secondary rounded-xl px-5 py-3 text-lg">Back to Session</button>
      </div>
      <p class="mb-6">Watch the sequence, then tap the blocks.</p>
      <div id="grid" class="grid grid-cols-3 gap-4 justify-items-center"></div>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())

    const grid = container.querySelector<HTMLDivElement>('#grid')
    const buttons: HTMLButtonElement[] = []
    for (let i = 0; i < 9; i += 1) {
      const button = document.createElement('button')
      button.className = 'block-button'
      button.dataset.index = String(i)
      grid?.appendChild(button)
      buttons.push(button)
    }

    for (const index of sequence) {
      buttons[index].classList.add('corsi-active')
      await wait(650)
      buttons[index].classList.remove('corsi-active')
      await wait(250)
    }

    const response: number[] = []
    await new Promise<void>((resolve) => {
      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          response.push(Number(button.dataset.index))
          button.classList.add('corsi-tap')
          setTimeout(() => {
            button.classList.remove('corsi-tap')
          }, 250)
          if (response.length === sequence.length) {
            resolve()
          }
        })
      })
    })

    const correct = sequence.every((value, idx) => value === response[idx])

    renderShell(`
      <h2 class="text-2xl font-semibold mb-2">${correct ? 'Correct' : 'Not quite'}</h2>
      <p class="mb-4">${correct ? 'Great job.' : 'The sequence was different.'}</p>
      <button id="next" class="btn-primary rounded-xl px-6 py-4 text-lg">Continue</button>
    `)

    await new Promise<void>((resolve) => {
      container.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => resolve())
    })

    return correct
  }

  renderInstructions()
}
