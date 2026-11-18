import json, struct, sys, os
def chunk(path):
    with open(path,'rb') as f:
        h=f.read(12); l,t=struct.unpack('<I4s',f.read(8)); return json.loads(f.read(l))
for p in sys.argv[1:]:
    j=chunk(p); ext=j.get('extensions',{}); nodes=j.get('nodes',[])
    name=''; joints=0; chains=0; coll=0; caps=0; centers=set(); maxdepth=0
    if 'VRMC_springBone' in ext:
        sb=ext['VRMC_springBone']; name=ext.get('VRMC_vrm',{}).get('meta',{}).get('name','')
        # The last joint of a VRM 1.0 spring is its tail; three-vrm simulates len(joints)-1 bones.
        chains=len(sb.get('springs',[])); joints=sum(len(s['joints'])-1 for s in sb.get('springs',[]))
        cols=sb.get('colliders',[]); coll=len(cols); caps=sum(1 for c in cols if 'capsule' in c.get('shape',{}))
        centers={s.get('center') for s in sb.get('springs',[]) if s.get('center') is not None}
        ver='1'
        # collision checks per joint: sum over joints of colliders in its groups
        groups=sb.get('colliderGroups',[])
        checks=sum((len(s['joints'])-1)*sum(len(groups[g]['colliders']) for g in s.get('colliderGroups',[])) for s in sb.get('springs',[]))
    elif 'VRM' in ext:
        v=ext['VRM']; name=v.get('meta',{}).get('title',''); sa=v.get('secondaryAnimation',{}); ver='0'
        # VRM0: each boneGroup has root bones; joints = all descendants of each root
        def count(i):
            return 1+sum(count(c) for c in nodes[i].get('children',[]))
        bgs=sa.get('boneGroups',[]); chains=sum(len(b.get('bones',[])) for b in bgs)
        joints=sum(count(r) for b in bgs for r in b.get('bones',[]))
        cgs=sa.get('colliderGroups',[]); coll=sum(len(c.get('colliders',[])) for c in cgs)
        centers={b.get('center') for b in bgs if b.get('center',-1)!=-1}
        checks=sum(count(r)*sum(len(cgs[g]['colliders']) for g in b.get('colliderGroups',[])) for b in bgs for r in b.get('bones',[]))
    else: ver='-'; checks=0
    print(f"{os.path.basename(p)[:20]}\tv{ver}\t{name[:28]:28}\tnodes={len(nodes)}\tchains={chains}\tjoints={joints}\tcolliders={coll}\tcaps={caps}\tcenters={len(centers)}\tcollisionChecks/step={checks}")
