/** Content coverage is independent of learner suppression and cue scheduling. */
export function isProductionProxied(coverage: {
  hasSharedPureCue: boolean;
  hasSharedTargetedCue: boolean;
}): boolean {
  return coverage.hasSharedPureCue && !coverage.hasSharedTargetedCue;
}

/** A usable targeted cue may serve a proxied word; dictionary fallback may not. */
export function allowsProductionUnderProxyPolicy(input: {
  proxied: boolean;
  hasUsableTargetedCue: boolean;
}): boolean {
  return !input.proxied || input.hasUsableTargetedCue;
}
