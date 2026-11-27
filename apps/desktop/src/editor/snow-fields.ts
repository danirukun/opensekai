import type {SnowSettings} from '@opensekai/contracts';
import {SLIDERS,type SliderRange} from './slider';
type NumberKey={[K in keyof SnowSettings]:SnowSettings[K] extends number?K:never}[keyof SnowSettings];
// The sliders of the Physics section of a snow entity, in the order of the settings (snow Inspector R2).
export const SNOW_FIELDS:readonly (readonly [NumberKey,string,SliderRange])[]=[
 ['rate','Rate',SLIDERS.snowRate],
 ['fallSpeed','Fall Speed (m/s)',SLIDERS.snowFallSpeed],
 ['flakeSize','Flake Size',SLIDERS.snowFlakeSize],
 ['flutter','Flutter',SLIDERS.snowFlutter],
 ['windDirection','Wind Direction (°)',SLIDERS.snowWindDirection],
 ['windSpeed','Wind Speed (m/s)',SLIDERS.snowWindSpeed],
 ['buildUpSeconds','Build-Up Time (s)',SLIDERS.snowSeconds],
 ['meltSeconds','Melt Time (s)',SLIDERS.snowSeconds],
 ['thickness','Thickness (m)',SLIDERS.snowThickness],
];
