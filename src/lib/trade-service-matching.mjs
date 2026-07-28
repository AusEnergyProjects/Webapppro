function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item))]
    : [];
}

export function matchedServiceCategories(categories, capabilities) {
  const capabilitySet = new Set(uniqueStrings(capabilities));
  return uniqueStrings(categories).filter((category) => capabilitySet.has(category));
}

function countBits(value) {
  let remaining = value;
  let count = 0;
  while (remaining) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

function betterSelection(left, right) {
  if (!right) return true;
  if (left.length !== right.length) return left.length < right.length;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

export function selectInstallerCandidatesForCoverage(candidates, categories, limit) {
  const pool = Array.isArray(candidates) ? candidates : [];
  const requested = uniqueStrings(categories).slice(0, 30);
  const maximum = Math.max(0, Math.min(Number.isInteger(limit) ? limit : 0, pool.length));
  if (!maximum) return [];
  if (!requested.length) return pool.slice(0, maximum);

  const categoryIndex = new Map(requested.map((category, index) => [category, index]));
  const coverageMasks = pool.map((candidate) => uniqueStrings(candidate?.matchedCategories)
    .reduce((mask, category) => {
      const index = categoryIndex.get(category);
      return index === undefined ? mask : mask | (1 << index);
    }, 0));
  const fullMask = (1 << requested.length) - 1;
  let states = new Map([[0, []]]);

  for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex += 1) {
    const candidateMask = coverageMasks[candidateIndex];
    if (!candidateMask) continue;
    const nextStates = new Map(states);
    for (const [mask, selected] of states) {
      if (selected.length >= maximum) continue;
      const combinedMask = mask | candidateMask;
      const combinedSelection = [...selected, candidateIndex];
      if (betterSelection(combinedSelection, nextStates.get(combinedMask))) {
        nextStates.set(combinedMask, combinedSelection);
      }
    }
    states = nextStates;
  }

  let selectedIndexes = states.get(fullMask);
  if (!selectedIndexes) {
    let bestMask = 0;
    let bestSelection = [];
    for (const [mask, selected] of states) {
      const covered = countBits(mask);
      const bestCovered = countBits(bestMask);
      if (
        covered > bestCovered
        || (covered === bestCovered && betterSelection(selected, bestSelection))
      ) {
        bestMask = mask;
        bestSelection = selected;
      }
    }
    selectedIndexes = bestSelection;
  }

  const selectedSet = new Set(selectedIndexes);
  for (let index = 0; index < pool.length && selectedIndexes.length < maximum; index += 1) {
    if (!selectedSet.has(index)) {
      selectedIndexes.push(index);
      selectedSet.add(index);
    }
  }
  return selectedIndexes.map((index) => pool[index]);
}
