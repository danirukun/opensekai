import { z } from 'zod';

// DOTween `Ease` names, as Warudo shows them. Formulas from easings.net (Penner).
export const EASINGS = [
 'Linear',
 'InSine', 'OutSine', 'InOutSine', 'InQuad', 'OutQuad', 'InOutQuad', 'InCubic', 'OutCubic', 'InOutCubic',
 'InQuart', 'OutQuart', 'InOutQuart', 'InQuint', 'OutQuint', 'InOutQuint', 'InExpo', 'OutExpo', 'InOutExpo',
 'InCirc', 'OutCirc', 'InOutCirc', 'InElastic', 'OutElastic', 'InOutElastic', 'InBack', 'OutBack', 'InOutBack',
 'InBounce', 'OutBounce', 'InOutBounce',
] as const;
export type Easing = (typeof EASINGS)[number];
export const EasingSchema = z.enum(EASINGS);
export const DEFAULT_EASING: Easing = 'Linear';

const BACK = 1.70158, BACK_IN_OUT = BACK * 1.525, ELASTIC = (2 * Math.PI) / 3, ELASTIC_IN_OUT = (2 * Math.PI) / 4.5;
const power = (n: number) => ({
 in: (t: number) => t ** n,
 out: (t: number) => 1 - (1 - t) ** n,
 inOut: (t: number) => (t < 0.5 ? 2 ** (n - 1) * t ** n : 1 - (-2 * t + 2) ** n / 2),
});
const outBounce = (t: number) => {
 const n = 7.5625, d = 2.75;
 if (t < 1 / d) return n * t * t;
 if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + 0.75; }
 if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + 0.9375; }
 const u = t - 2.625 / d;
 return n * u * u + 0.984375;
};
const [quad, cubic, quart, quint] = [power(2), power(3), power(4), power(5)];
const CURVES: Record<Easing, (t: number) => number> = {
 Linear: t => t,
 InSine: t => 1 - Math.cos((t * Math.PI) / 2),
 OutSine: t => Math.sin((t * Math.PI) / 2),
 InOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
 InQuad: quad.in, OutQuad: quad.out, InOutQuad: quad.inOut,
 InCubic: cubic.in, OutCubic: cubic.out, InOutCubic: cubic.inOut,
 InQuart: quart.in, OutQuart: quart.out, InOutQuart: quart.inOut,
 InQuint: quint.in, OutQuint: quint.out, InOutQuint: quint.inOut,
 InExpo: t => 2 ** (10 * t - 10),
 OutExpo: t => 1 - 2 ** (-10 * t),
 InOutExpo: t => (t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
 InCirc: t => 1 - Math.sqrt(1 - t * t),
 OutCirc: t => Math.sqrt(1 - (t - 1) ** 2),
 InOutCirc: t => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2),
 InElastic: t => -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ELASTIC),
 OutElastic: t => 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC) + 1,
 InOutElastic: t => (t < 0.5
  ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT)) / 2
  : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * ELASTIC_IN_OUT)) / 2 + 1),
 InBack: t => (BACK + 1) * t ** 3 - BACK * t * t,
 OutBack: t => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2,
 InOutBack: t => (t < 0.5
  ? ((2 * t) ** 2 * ((BACK_IN_OUT + 1) * 2 * t - BACK_IN_OUT)) / 2
  : ((2 * t - 2) ** 2 * ((BACK_IN_OUT + 1) * (t * 2 - 2) + BACK_IN_OUT) + 2) / 2),
 InBounce: t => 1 - outBounce(1 - t),
 OutBounce: outBounce,
 InOutBounce: t => (t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2),
};

// Progress `t` is clamped to 0..1, and the ends are exact, so a finished transition lands on its target.
export function ease(name: Easing, t: number): number {
 if (!(t > 0)) return 0;
 if (t >= 1) return 1;
 return CURVES[name](t);
}
