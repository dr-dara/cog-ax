import type { TestContext, TestResult } from '../types'
import { wait } from './utils'

const makeSequence = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 9) + 1)

const speakSequence = (sequence: number[]) => {
  if (!('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(sequence.join(' '))
  utterance.rate = 0.9
  utterance.pitch = 1
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

export const renderBackwardDigitSpan = (container: HTMLElement, ctx: TestContext) => {
  let cancelled = false
  const state = {
    maxSpan: 1,
    consecutiveErrors: 0,
    currentLength: 2,
    totalTrials: 0,
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
      <h1 class="text-3xl font-semibold mb-4 high-contrast">Backward Digit Span</h1>
      <p class="mb-4">You will see a short list of numbers. Your task is to type the numbers in reverse order.</p>
      <ul class="list-disc pl-6 mb-6 text-left">
        <li>Start with short sequences.</li>
        <li>If you get two in a row wrong, the test will end.</li>
        <li>You can click “Speak sequence” if you want the numbers read aloud.</li>
      </ul>
      <div class="flex flex-col md:flex-row gap-4">
        <button id="start-practice" class="btn-primary rounded-xl px-6 py-4 text-lg">Start Practice</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
    `)

    const startButton = container.querySelector<HTMLButtonElement>('#start-practice')
    const exitButton = container.querySelector<HTMLButtonElement>('#exit-test')

    startButton?.addEventListener('click', () => runPractice())
    exitButton?.addEventListener('click', () => handleExit())
  }

  const runPractice = async () => {
    const practiceLength = 2
    const sequence = makeSequence(practiceLength)
    const correct = await runTrial(sequence, true)
    if (cancelled) return
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Practice complete</h2>
      <p class="mb-6">${correct ? 'Nice work! You can start the real test now.' : 'That was just practice. You can start the real test now.'}</p>
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
      const sequence = makeSequence(state.currentLength)
      const correct = await runTrial(sequence, false)
      if (cancelled) return
      state.totalTrials += 1

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
      test: 'digit-span',
      score: state.maxSpan,
      timestamp: new Date().toISOString(),
      metrics: {
        maxSpan: state.maxSpan,
        totalTrials: state.totalTrials,
      },
    }

    const saveState = await ctx.onSave(result)
    renderShell(`
      <h2 class="text-2xl font-semibold mb-4">Test complete</h2>
      <p class="mb-2">Maximum span recalled: <strong>${state.maxSpan}</strong></p>
      <p class="mb-6 hint">${saveState.message}</p>
      <button id="exit-test" class="btn-primary rounded-xl px-6 py-4 text-lg">Back to Session</button>
    `)

    container.querySelector<HTMLButtonElement>('#exit-test')?.addEventListener('click', () => handleExit())
  }

  const runTrial = async (sequence: number[], isPractice: boolean) => {
    renderShell(`
      <h2 class="text-2xl font-semibold mb-2">${isPractice ? 'Practice Round' : `Sequence length ${sequence.length}`}</h2>
      <p class="mb-6">Remember these numbers and type them in reverse order.</p>
      <div class="text-5xl font-semibold tracking-[0.5rem] mb-6" id="sequence">Ready</div>
      <div class="flex flex-col md:flex-row gap-4 mb-6">
        <button id="speak" class="btn-secondary rounded-xl px-6 py-4 text-lg">Speak sequence</button>
        <button id="exit-test" class="btn-secondary rounded-xl px-6 py-4 text-lg">Back to Session</button>
      </div>
      <form id="answer-form" class="hidden">
        <label class="block mb-2 text-lg">Enter digits in reverse order</label>
        <input id="answer" type="text" inputmode="numeric" class="input-field mb-4" placeholder="Example: 2 9 5" />
        <button type="submit" class="btn-primary rounded-xl px-6 py-4 text-lg">Submit</button>
      </form>
    `)

    const speakButton = container.querySelector<HTMLButtonElement>('#speak')
    const exitButton = container.querySelector<HTMLButtonElement>('#exit-test')
    const sequenceEl = container.querySelector<HTMLDivElement>('#sequence')
    const form = container.querySelector<HTMLFormElement>('#answer-form')
    const input = container.querySelector<HTMLInputElement>('#answer')

    speakButton?.addEventListener('click', () => speakSequence(sequence))
    exitButton?.addEventListener('click', () => handleExit())

    if (sequenceEl) {
      sequenceEl.textContent = sequence.join(' ')
    }
    speakSequence(sequence)
    await wait(1300 + sequence.length * 450)

    if (sequenceEl) {
      sequenceEl.textContent = '...'
    }

    form?.classList.remove('hidden')
    input?.focus()

    const answer = await new Promise<string>((resolve) => {
      form?.addEventListener('submit', (event) => {
        event.preventDefault()
        resolve(input?.value ?? '')
      })
    })

    const expected = [...sequence].reverse().join(' ')
    const expectedDigits = [...sequence].reverse().join('')
    const normalizedDigits = answer.replace(/\D/g, '')

    const correct = normalizedDigits === expectedDigits

    renderShell(`
      <h2 class="text-2xl font-semibold mb-2">${correct ? 'Correct!' : 'Not quite'}</h2>
      <p class="mb-4">The correct answer was <strong>${expected}</strong>.</p>
      <button id="next" class="btn-primary rounded-xl px-6 py-4 text-lg">${isPractice ? 'Continue' : 'Next'}</button>
    `)

    await new Promise<void>((resolve) => {
      container.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', () => resolve())
    })

    return correct
  }

  renderInstructions()
}
