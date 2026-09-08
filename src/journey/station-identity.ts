const providerDescriptorSuffixes = [
  'underground station',
  'national rail station',
  'railway station',
  'tube station',
  'national rail',
  'interchange',
  'underground',
  'station',
  'tube',
] as const;

/**
 * TfL represents a station with transport descriptors in commonName
 * (for example, "Waterloo Station"). User input normally omits them.
 * Only trailing, generic descriptors are removed; no fuzzy or substring
 * matching is used.
 */
export function stationNamesMatch(left: string, right: string): boolean {
  const leftCanonical = canonicalStationName(left);
  const rightCanonical = canonicalStationName(right);
  return (
    leftCanonical !== '' &&
    rightCanonical !== '' &&
    leftCanonical === rightCanonical
  );
}

export function canonicalStationName(value: string): string {
  let canonical = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0027\u2019]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of providerDescriptorSuffixes) {
      if (canonical === suffix) return '';
      if (canonical.endsWith(' ' + suffix)) {
        canonical = canonical.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return canonical;
}
