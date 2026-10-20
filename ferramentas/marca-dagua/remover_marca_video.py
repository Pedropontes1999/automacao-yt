import sys, os, subprocess, time
import cv2, numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1440, 2560
# watermark box ("HISTORIAS GEEK" under the captions), same position in every video
MX0, MY0, MX1, MY1 = 420, 1488, 1020, 1638
# LaMa context crop around it (square, resized to the model's 512 input)
CX0, CY0, CS = 336, 1178, 768

def lama_session():
    ort.set_default_logger_severity(3)
    return ort.InferenceSession(os.path.join(HERE, 'model', 'lama_fp32.onnx'), providers=['CPUExecutionProvider'])

def main():
    src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    ss, t = (sys.argv[4], sys.argv[5]) if len(sys.argv) > 5 else (None, None)
    clip = ['-ss', ss, '-t', t] if ss else []
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', *clip, '-i', src, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', '30',
                            '-i', '-', *clip, '-i', src, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-crf', '18',
                            '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', dst],
                           stdin=subprocess.PIPE)
    mask = np.zeros((H, W), np.uint8); mask[MY0:MY1, MX0:MX1] = 255
    feather = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 3)[..., None]
    # region used to decide whether the area around the watermark changed (sides + below, not the captions above)
    ring = cv2.dilate(mask, np.ones((61, 61), np.uint8)) & ~mask
    ring[:MY0, :] = 0
    sess = lama_session() if mode == 'A' else None
    cm = cv2.resize(mask[CY0:CY0 + CS, CX0:CX0 + CS], (512, 512), interpolation=cv2.INTER_NEAREST)
    cm = (cv2.dilate(cm, np.ones((3, 3), np.uint8)) > 0).astype(np.float32)[None, None]
    prev_ring, prev_fill, n, runs, t0 = None, None, 0, 0, time.time()
    while True:
        buf = dec.stdout.read(W * H * 3)
        if len(buf) < W * H * 3: break
        f = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
        if mode == 'A':
            r = f[ring > 0].astype(np.int16)
            if prev_fill is None or np.abs(r - prev_ring).mean() > 3.0:
                crop = f[CY0:CY0 + CS, CX0:CX0 + CS]
                x = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), (512, 512), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
                out = sess.run(None, {'image': x.transpose(2, 0, 1)[None], 'mask': cm})[0][0].transpose(1, 2, 0)
                if out.max() <= 1.5: out = out * 255
                out = cv2.cvtColor(cv2.resize(np.clip(out, 0, 255).astype(np.uint8), (CS, CS), interpolation=cv2.INTER_CUBIC), cv2.COLOR_RGB2BGR)
                new = out[MY0 - CY0 - 6:MY1 - CY0 + 6, MX0 - CX0 - 6:MX1 - CX0 + 6].astype(np.float32)
                # light temporal smoothing against the previous fill to reduce flicker
                prev_fill = new if prev_fill is None or np.abs(r - prev_ring).mean() > 12 else 0.6 * new + 0.4 * prev_fill
                runs += 1
            prev_ring = r
            reg = f[MY0 - 6:MY1 + 6, MX0 - 6:MX1 + 6].astype(np.float32)
            a = feather[MY0 - 6:MY1 + 6, MX0 - 6:MX1 + 6]
            f[MY0 - 6:MY1 + 6, MX0 - 6:MX1 + 6] = (prev_fill * a + reg * (1 - a)).astype(np.uint8)
        else:
            # C: frosted dark band over the watermark row
            y0, y1, x0, x1 = MY0 - 4, MY1 + 6, 300, 1140
            reg = f[y0:y1, x0:x1].astype(np.float32)
            band = cv2.GaussianBlur(f[y0 - 40:y1 + 40, x0 - 40:x1 + 40], (0, 0), 22)[40:-40, 40:-40].astype(np.float32) * 0.35
            m = np.zeros(reg.shape[:2], np.float32)
            cv2.rectangle(m, (18, 10), (m.shape[1] - 18, m.shape[0] - 10), 1, -1)
            m = cv2.GaussianBlur(m, (0, 0), 7)[..., None]
            f[y0:y1, x0:x1] = (band * m + reg * (1 - m)).astype(np.uint8)
        enc.stdin.write(f.tobytes())
        n += 1
        if n % 60 == 0: print(f'{n} frames, {runs} IA, {time.time() - t0:.0f}s', flush=True)
    enc.stdin.close(); enc.wait(); dec.wait()
    print(f'done {n} frames, {runs} IA runs, {time.time() - t0:.0f}s')

if __name__ == '__main__':
    main()
