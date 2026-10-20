import sys, glob, os, json, cv2, numpy as np
from rapidocr_onnxruntime import RapidOCR
eng = RapidOCR()
src = sys.argv[1]
out = {}
for f in sorted(glob.glob(os.path.join(src, '*.jpg'))):
    name = os.path.basename(f)
    if name.startswith('Histórias Geek'): continue
    img = cv2.imdecode(np.fromfile(f, np.uint8), cv2.IMREAD_COLOR)
    res, _ = eng(img)
    out[name] = [[[list(map(int,p)) for p in r[0]], r[1], float(r[2])] for r in (res or [])]
json.dump(out, open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(out))
