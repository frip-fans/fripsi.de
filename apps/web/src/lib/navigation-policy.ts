// Keep iOS Safari on document navigation while its ClientRouter regression is
// investigated on a real device. In-page searches and pagination remain enhanced.
export function usesNativePageNavigation(userAgent: string): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent)
    && /Version\/[\d.]+.*Safari\//.test(userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}
