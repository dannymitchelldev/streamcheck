import { runStreamCheck, type LiveOptions, type RunResult, type TextMessage } from 'streamcheck';

// Compile-only example: calling this function explicitly makes one potentially billable request.
// The application owns history and decides whether to retain an interrupted answer.
export function answerFollowUp(apiKey: string, model: string): Promise<RunResult> {
  const messages: readonly [TextMessage, ...TextMessage[]] = [
    { role: 'system', content: 'Explain concepts concisely.' },
    { role: 'user', content: 'What is a webhook?' },
    { role: 'assistant', content: 'An HTTP notification sent when an event occurs.' },
    { role: 'user', content: 'How does the receiver acknowledge it?' },
  ];
  const options: LiveOptions = {
    apiKey, model, messages,
    onText(delta) { process.stdout.write(delta); },
  };
  return runStreamCheck(options);
}
