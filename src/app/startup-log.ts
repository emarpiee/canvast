/**
 * Start-up timing: each step of opening a workspace is marked (`canvast:start:<step>`) and said in the console with the time since the
 * page began, so a slow start can be read in the developer tools (View > Toggle Developer Tools in the desktop app). Each step once.
 */
const said = new Set<string>();
const listeners = new Set<(step: string) => void>();

/** Told each step as it is reached (the start screen says what comes next). */
export function onStartStep(fn: (step: string) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function startStep(step: string): void {
  if (said.has(step)) return;
  said.add(step);
  performance.mark(`canvast:start:${step}`);
  console.info(`canvast start: ${step} at ${(performance.now() / 1000).toFixed(1)} s`);
  for (const fn of listeners) fn(step);
}
