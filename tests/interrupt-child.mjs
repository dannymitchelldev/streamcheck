// Portable handler verification, not a claim about physical Windows console Ctrl+C.
import { main } from '../dist/cli.js';
process.on('message', message => { if (message === 'interrupt') process.emit('SIGINT'); });
const pending = main(process.argv.slice(2));
process.send?.('running');
process.exitCode = await pending;
process.disconnect?.();
