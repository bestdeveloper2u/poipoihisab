/**
 * Drop immediately-repeated token runs from live dictation text.
 *
 * bn-BD rides Chrome's server speech engine, which stutters on flaky
 * mobile networks — interim hypotheses arrive with the head word repeated
 * ("ডিম ডিম ডিম ডিম ১৫০", owner screenshot 2026-09-07 11:31). The largest
 * adjacent token-run that repeats collapses to one copy — the same rule
 * as the API-side `_collapse_repeats` (defense in depth: the live
 * textarea shows what the user meant even before the parser cleans the
 * submission). Typed text never passes through here (only mic onresult
 * does), so deliberate typed repeats are untouched.
 */
export function collapseRepeatedRuns(text: string): string {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    for (let size = Math.floor(tokens.length / 2); size > 0; size--) {
      for (let i = 0; i + 2 * size <= tokens.length; i++) {
        const head = tokens.slice(i, i + size).join(" ");
        const next = tokens.slice(i + size, i + 2 * size).join(" ");
        if (head === next) {
          tokens.splice(i + size, size);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return tokens.join(" ");
}
