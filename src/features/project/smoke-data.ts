/** Synthetic reads, generated without any external biological data. */
export function smokeFastq(seed: number, mate: 1 | 2 = 1, count = 200): string {
  let state = seed >>> 0;
  const base = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return "ACGT"[state >>> 30];
  };
  return Array.from({ length: count }, (_, index) => {
    const sequence = Array.from({ length: 100 }, base).join("");
    return `@synthetic_${seed}_${index + 1}/${mate}\n${sequence}\n+\n${"I".repeat(sequence.length)}\n`;
  }).join("");
}
