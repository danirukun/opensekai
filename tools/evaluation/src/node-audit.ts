// BP-13: each OpenSekai node type maps to one Warudo palette category, or to null when Warudo has no counterpart.
export interface NodeAuditRow {
    type: string;
    warudoCategory: string | null;
    warudoCandidate: string | null;
    evidence: 'macOS' | 'tests';
    note?: string;
}
export interface NodeAudit {
    warudoSource: string;
    warudoPalette: Record<string, number>;
    nodes: NodeAuditRow[];
}
export interface NodeAuditProblems {
    unaudited: string[];
    stale: string[];
    duplicate: string[];
    unknownCategory: string[];
}
export interface CategoryCoverage {
    category: string;
    warudo: number;
    opensekai: number;
}

export function checkNodeAudit(catalog: readonly { type: string }[], audit: NodeAudit): NodeAuditProblems {
    const types = new Set(catalog.map(node => node.type));
    const rows = audit.nodes.map(row => row.type);
    return {
        unaudited: [...types].filter(type => !rows.includes(type)),
        stale: rows.filter(type => !types.has(type)),
        duplicate: rows.filter((type, index) => rows.indexOf(type) !== index),
        unknownCategory: audit.nodes.filter(row => row.warudoCategory !== null && !Object.hasOwn(audit.warudoPalette, row.warudoCategory)).map(row => row.type),
    };
}

export const categoryCoverage = (audit: NodeAudit): CategoryCoverage[] =>
    Object.entries(audit.warudoPalette).map(([category, warudo]) => ({
        category, warudo, opensekai: audit.nodes.filter(row => row.warudoCategory === category).length,
    }));
