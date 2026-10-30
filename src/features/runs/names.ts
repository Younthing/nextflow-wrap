const ADJECTIVES = ["agitated", "amazing", "angry", "astonishing", "awesome", "big", "boring", "clever", "cranky", "curious", "distracted", "drunk", "ecstatic", "elated", "evil", "exotic", "fervent", "focused", "friendly", "furious", "gigantic", "golden", "happy", "hopeful", "hungry", "intergalactic", "jolly", "kickass", "lethal", "loving", "magical", "mad", "nasty", "nice", "nostalgic", "pedantic", "prickly", "reverent", "romantic", "sad", "serene", "sharp", "shrivelled", "sick", "silly", "sleepy", "small", "special", "stoic", "suspicious", "tender", "thirsty", "tiny", "trusting", "zen"];
const SCIENTISTS = ["archimedes", "avogadro", "babbage", "bohr", "curie", "darwin", "einstein", "euler", "faraday", "fermi", "franklin", "galileo", "goodall", "hodgkin", "hopper", "hypatia", "kepler", "lamarck", "lovelace", "mcclintock", "meitner", "mendel", "newton", "noether", "pasteur", "pauling", "planck", "ride", "sanger", "shannon", "tesla", "turing", "watson", "wright"];

/** A Nextflow-style run name such as `tender_curie`. */
export function randomRunName(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (let i = 0; i < 50; i++) {
    const name = `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}_${SCIENTISTS[Math.floor(Math.random() * SCIENTISTS.length)]}`;
    if (!used.has(name)) return name;
  }
  return `run_${Date.now().toString(36)}`;
}
