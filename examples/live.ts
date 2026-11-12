import { runStreamCheck } from 'streamcheck';

// Running this example explicitly requests a live, potentially billable call.
const result = await runStreamCheck({
  apiKey: process.env['OPENROUTER_API_KEY'] ?? '',
  model: process.argv[2] ?? '',
  prompt: 'Explain webhooks in two sentences.',
  maxTokens: 256,
  timeoutMs: 30_000,
  onText(delta) { process.stdout.write(delta); },
});

console.log('\n\n' + JSON.stringify(result, null, 2));
if (result.outcome !== 'success') process.exitCode = 1;
