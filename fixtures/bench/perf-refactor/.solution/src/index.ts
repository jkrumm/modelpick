/** The letters of `word`, sorted — two anagrams share the same signature. */
function signature(word: string): string {
  return [...word].sort().join("");
}

/** Index of the first entry of the ascending `indices` that is greater than `after`. */
function firstAbove(indices: number[], after: number): number {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (indices[mid]! <= after) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Every index pair `[i, j]` with `i < j` whose values sum to `target`.
 *
 * Pairs come back ordered by `i` ascending, then by `j` ascending. Callers
 * depend on that order, so it is part of the contract.
 *
 * One pass builds value -> ascending indices; the second walks `i` in order and
 * binary-searches the complement's bucket for the indices after `i`, so the
 * documented ordering falls out without a sort.
 */
export function findPairs(values: number[], target: number): Array<[number, number]> {
  const byValue = new Map<number, number[]>();
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    const bucket = byValue.get(value);
    if (bucket) bucket.push(i);
    else byValue.set(value, [i]);
  }

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < values.length; i++) {
    const bucket = byValue.get(target - values[i]!);
    if (!bucket) continue;
    for (let k = firstAbove(bucket, i); k < bucket.length; k++) {
      pairs.push([i, bucket[k]!]);
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
 *
 * A signature -> group map replaces the linear scan over existing groups; the
 * group array still records first-occurrence order.
 */
export function groupAnagrams(words: string[]): string[][] {
  const bySignature = new Map<string, string[]>();
  const groups: string[][] = [];
  for (const word of words) {
    const key = signature(word);
    const existing = bySignature.get(key);
    if (existing) {
      existing.push(word);
      continue;
    }
    const created = [word];
    bySignature.set(key, created);
    groups.push(created);
  }
  return groups;
}
