export type SpeechRecognitionResult = {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

export type SpeechRecognitionEvent = Event & {
  readonly results: ArrayLike<SpeechRecognitionResult>
}

export type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: Event) => void) | null
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
