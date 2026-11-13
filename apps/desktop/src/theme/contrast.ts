export type Rgb = readonly [number, number, number];

const linear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([red, green, blue]: Rgb): number =>
  0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);

export const contrastRatio = (foreground: Rgb, background: Rgb): number => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

export const parseHex = (hex: string): Rgb => {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

export const composite = (foreground: Rgb, background: Rgb, alpha: number): Rgb => [
  Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
  Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
  Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
];
