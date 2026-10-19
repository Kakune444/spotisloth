export type AudioQuality = "normal" | "high" | "veryHigh";
export type ReportedQuality = "low" | AudioQuality | "lossless" | "lossless24";
export type AudioSettings = {
  quality: AudioQuality;
  activeQuality: AudioQuality | null;
  restartRequired: boolean;
};
export const qualityOptions: { value: AudioQuality; label: string }[] = [
  { value: "normal", label: "Normale — 96 kbit/s" },
  { value: "high", label: "Élevée — 160 kbit/s" },
  { value: "veryHigh", label: "Très élevée — 320 kbit/s" },
];
export function isAudioQuality(value: string): value is AudioQuality {
  return qualityOptions.some((option) => option.value === value);
}
export function qualityLabel(quality: ReportedQuality | null): string {
  if (!quality) return "Non communiquée";
  return (
    {
      low: "Faible",
      normal: "Normale",
      high: "Élevée",
      veryHigh: "Très élevée",
      lossless: "Lossless",
      lossless24: "Lossless — 24 bits",
    }[quality] ?? "Non communiquée"
  );
}
