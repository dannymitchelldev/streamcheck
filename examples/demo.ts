import { runDemo } from 'streamcheck';

const result = await runDemo({
  scenario: 'interrupted',
  onText(delta) { process.stdout.write(delta); },
});

console.log('\n\n' + JSON.stringify(result, null, 2));
// A handled failure is useful data. This example deliberately exits 0.
if (result.outcome === 'interrupted') console.log('Retained text:', result.text);
