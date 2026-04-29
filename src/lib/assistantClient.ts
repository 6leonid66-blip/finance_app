import { sendAssistantChat } from './geminiReceipt'
import type { AssistantAction, AssistantChatMessage } from './geminiReceipt'
import type { CompactLedger } from './assistantContext'

export type { AssistantAction, AssistantChatMessage } from './geminiReceipt'

export async function chatWithAssistant(params: {
  messages: AssistantChatMessage[]
  ledger: CompactLedger
}): Promise<{ reply: string; action?: AssistantAction }> {
  return sendAssistantChat({
    messages: params.messages,
    ledger: params.ledger,
  })
}
