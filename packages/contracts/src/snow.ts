import type { SnowSettings } from './types';

export const DEFAULT_SNOW: Readonly<SnowSettings> = Object.freeze({
    rate: 0.5,
    fallSpeed: 1,
    flakeSize: 1,
    flutter: 1,
    windDirection: 0,
    windSpeed: 0,
    buildUpSeconds: 45,
    meltSeconds: 20,
    thickness: 0.015,
    settleOnCharacters: true,
    settleOnProps: true,
    settleOnEnvironment: true
});
