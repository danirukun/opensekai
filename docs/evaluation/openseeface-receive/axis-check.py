# Cross-check of the OpenSeeFace head conversion (B20) against OpenCV solvePnP and the tracker face model.
# It projects the tracker 3D contour points for a known head pose, swaps each image point to (row, column) as the
# tracker does, solves the pose with cv2.solvePnP, makes the packet quaternion with the tracker's
# matrix_to_quaternion, and applies the decoder formula. Usage (needs numpy and opencv-python-headless):
#   python3 axis-check.py <path to OpenSeeFace tracker.py>
import sys, re, numpy as np, cv2
src = open(sys.argv[1]).read()
exec(re.search(r"def matrix_to_quaternion.*?return q\n", src, re.S).group(0))
block = re.search(r"self.face_3d = np.array\(\[(.*?)\], np.float32\)", src, re.S).group(1)
model = np.array([[float(v) for v in row.split(',')] for row in re.findall(r"\[([^\[\]]+)\]", block)], np.float64)
contour = model[[0,1,8,15,16,27,28,29,30,31,32,33,34,35]]
def axis(ax, deg):
    a=np.radians(deg); c,s=np.cos(a),np.sin(a)
    return {'x':np.array([[1,0,0],[0,c,-s],[0,s,c]]),'y':np.array([[c,0,s],[0,1,0],[-s,0,c]]),'z':np.array([[c,-s,0],[s,c,0],[0,0,1]])}[ax]
def qmat(q):
    x,y,z,w=q
    return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
# A square image keeps the principal point on the swapped axes. A 4:3 image adds a constant offset (see the evidence).
W,H=640,640
K=np.array([[W,0,W/2],[0,W,H/2],[0,0,1]],np.float64)
A=np.diag([1.,-1.,-1.])  # avatar (x left, y up, z forward) <-> OpenCV camera (x right, y down, z away)
def packet_quat(avatar_rot):
    # Physical head facing the camera: model +X (performer right) = -X cam, +Y up = -Y cam, +Z forward = -Z cam.
    R_cam = A @ avatar_rot @ A
    pts = (R_cam @ (-contour.T)).T + np.array([0,0,4.0])
    uv = (K @ pts.T).T; uv = uv[:,:2]/uv[:,2:]
    rowcol = uv[:, ::-1].copy()  # the tracker stores landmarks as (row, column)
    ok,rvec,tvec = cv2.solvePnP(contour, rowcol, K, np.zeros((4,1)), flags=cv2.SOLVEPNP_ITERATIVE, useExtrinsicGuess=True, rvec=np.array([[2.2],[-2.2],[0.]]), tvec=np.array([[0.],[0.],[4.]]))
    rmat,_=cv2.Rodrigues(rvec)
    return matrix_to_quaternion(rmat).astype(np.float64)
def convert(q):
    x,y,z,w=q; s=np.sqrt(.5); return s*np.array([w+z,w-z,x+y,x-y])
ok=True
for name,rot in [('identity',np.eye(3)),('yaw left 30',axis('y',30)),('pitch up 20',axis('x',-20)),('roll left 15',axis('z',-15)),('mixed',axis('y',25)@axis('x',-10)@axis('z',12))]:
    q=convert(packet_quat(rot)); err=np.abs(qmat(q/np.linalg.norm(q))-rot).max()
    print(f"{name:12s} packet->avatar max matrix error {err:.2e}"); ok &= err<1e-4
print('PASS' if ok else 'FAIL')
