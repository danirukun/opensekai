import {showDirty,type ShowMark} from './show-management';

/** The start screen shows on a normal launch until the show mark first changes from its start value (start screen R1). */
export function startScreenOpen(input:{fixtureMode:boolean;ended:boolean;start:ShowMark|null;current:ShowMark}):boolean{
 return !input.fixtureMode&&!input.ended&&input.start!==null&&input.current.revision!==null&&!showDirty(input.start,input.current);
}
/** True once the show differs from the start mark; the caller keeps the end for the rest of the session. */
export function startScreenEnds(input:{start:ShowMark|null;current:ShowMark}):boolean{
 return input.start!==null&&showDirty(input.start,input.current);
}
