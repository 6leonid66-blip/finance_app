export type SpeechRecognitionResult = {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

export type SpeechRecognitionEvent = Event & {
  readonly results: ArrayLike<SpeechRecognitionResult>
}

export type SpeechRecognitionErrorEvent = Event & {
  readonly error?: string
}

export function transcriptFromSpeechEvent(event: SpeechRecognitionEvent): string {
  const parts: string[] = []
  for (let i = 0; i < event.results.length; i++) {
    const piece = event.results[i]?.[0]?.transcript?.trim()
    if (piece) parts.push(piece)
  }
  return parts.join(' ').trim()
}

export type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & {
    webkitSpeechRecognition?: SpeechRecognitionCtor
    SpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function parseVoiceTranscript(
  transcript: string,
  categories: readonly string[],
): {
  note?: string
  amount?: string
  category?: string
} {
  const trimmed = transcript.trim()
  if (!trimmed) return {}
  const result: { note?: string; amount?: string; category?: string } = { note: trimmed }
  const amountMatch = trimmed.match(/(\d+(?:[.,]\d{1,2})?)/)
  if (amountMatch?.[1]) {
    const parsedAmount = Number(amountMatch[1].replace(',', '.'))
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      result.amount = Number.isInteger(parsedAmount) ? String(parsedAmount) : parsedAmount.toFixed(2)
    }
  }
  const matched = categories.find((c) => trimmed.includes(c))
  if (matched) result.category = matched
  return result
}
