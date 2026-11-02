/** The preview draws only while the operator can see it: the Preview toggle is on and the Assets tab shows. */
export function previewActive(state:{toggleOn:boolean;assetsShown:boolean}):boolean{return state.toggleOn&&state.assetsShown;}
