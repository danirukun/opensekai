import { addComponent, addEntity, createWorld, removeEntity } from "bitecs";
import type { Id, SceneView, Transform } from "@opensekai/contracts";
import { evaluateSmokeTransform } from "./smoke-motion";
export function createTransformAdapter(scene: SceneView) {
    const world = createWorld();
    const ids = new Map<Id, number>();
    const packed = { values: [] as Float64Array[] };
    for (const entity of scene.entities) {
        const eid = addEntity(world);
        ids.set(entity.id, eid);
        addComponent(world, eid, packed);
        packed.values[eid] = new Float64Array(10);
    }
    return {
        evaluate(persistent: SceneView, elapsedMs: number): SceneView {
            const liveIds=new Set(persistent.entities.map(entity=>entity.id));
            for(const [id,eid] of ids){if(liveIds.has(id))continue;removeEntity(world,eid);ids.delete(id);delete packed.values[eid];}
            const evaluated = structuredClone(persistent);
            for (const entity of evaluated.entities) {
                const eid = ids.get(entity.id);
                let current=eid;
                if(current===undefined){current=addEntity(world);ids.set(entity.id,current);addComponent(world,current,packed);packed.values[current]=new Float64Array(10);}
                const transform = evaluateSmokeTransform(entity.id, entity.transform, elapsedMs);
                const data = packed.values[current]!;
                data.set([...transform.position, ...transform.rotation, ...transform.scale]);
                entity.transform = {
                    position: [data[0]!, data[1]!, data[2]!],
                    rotation: [data[3]!, data[4]!, data[5]!, data[6]!],
                    scale: [data[7]!, data[8]!, data[9]!],
                } satisfies Transform;
            }
            return evaluated;
        },
    };
}
