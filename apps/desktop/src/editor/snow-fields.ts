import {LIMITS,type SceneEntity,type SnowSettings,type Transform} from '@opensekai/contracts';
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
export const snowLimitReached=(entities:readonly SceneEntity[]):boolean=>entities.filter(entity=>entity.kind==='snow').length>=LIMITS.snows;
// The default snow box: the reset values of its transform, and the add default of Add › Snow (snow Inspector R8).
export const snowTransform=():Transform=>({position:[0,2,0],rotation:[0,0,0,1],scale:[6,4,6]});
