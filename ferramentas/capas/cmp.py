import sys,os,glob,cv2,numpy as np
src=r"C:/Users/User/Desktop/marketing/fotos de capa/originais"; dst=sys.argv[1]; out=sys.argv[2]; idx=list(map(int,sys.argv[3:]))
files=sorted(f for f in glob.glob(os.path.join(src,'*.jpg')) if 'Histórias Geek' not in os.path.basename(f))
cols=[]
for i in idx:
    a=cv2.imdecode(np.fromfile(files[i],np.uint8),1)[:,438:842]
    b=cv2.imdecode(np.fromfile(os.path.join(dst,os.path.basename(files[i])),np.uint8),1)[:,438:842]
    cols.append(np.vstack([cv2.resize(a,(202,360)),cv2.resize(b,(202,360))]))
cv2.imencode('.jpg',np.hstack(cols))[1].tofile(out)
