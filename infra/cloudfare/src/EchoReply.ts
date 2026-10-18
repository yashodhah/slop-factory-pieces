const QUOTE_LIMIT = 80
const WORKED = 'The broker, mailbox, handoff and delivery API all worked.'

/** The stub agent's whole answer: the start of the prompt quoted back, so the round trip is visible on GitHub. */
export const echoReply = (prompt: string): string => {
	const text = prompt.trim()
	if (text === '') return `Got it (no text in the comment). ${WORKED}`
	const quoted = text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}…` : text
	return `Got it: "${quoted}". ${WORKED}`
}
