// User patterns run here, so a slow pattern cannot block the Editor main thread (B18 R9).
import {matchRequest,type MatchRequest} from './hidden-cameras';
self.onmessage=(event:MessageEvent<MatchRequest>)=>{self.postMessage(matchRequest(event.data));};
