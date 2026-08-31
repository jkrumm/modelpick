/** The letters of `word`, sorted — two anagrams share the same signature. */
function signature(word: string): string {
  return [...word].sort().join("");
}

/**
 * Every index pair `[i, j]` with `i < j` whose values sum to `target`.
 *
 * Pairs come back ordered by `i` ascending, then by `j` ascending. Callers
 * depend on that order, so it is part of the contract.
 */
export function findPairs(values: number[], target: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i]! + values[j]! === target) pairs.push([i, j]);
    }
  }
  return pairs;
}

/**
 * Groups the words that are anagrams of one another.
 *
 * Groups come back in order of first occurrence, and the words inside a group
 * keep their input order. Callers depend on both, so they are part of the
 * contract.
 */
export function groupAnagrams(words: string[]): string[][] {
  const groups: string[][] = [];
  for (const word of words) {
    let placed = false;
    for (const group of groups) {
      if (signature(group[0]!) === signature(word)) {
        group.push(word);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([word]);
  }
  return groups;
}
