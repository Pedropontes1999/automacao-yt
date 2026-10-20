import sys, os, subprocess, time

# Roda remover_marca_video.py (modo A) em todos os .mp4 de uma pasta.
# Uso: python processar_pasta.py <pasta_videos> <pasta_saida> [modo]
# Retoma de onde parou: pula qualquer video que ja exista (completo) na pasta de saida.

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'remover_marca_video.py')

def main():
    src_dir, dst_dir = sys.argv[1], sys.argv[2]
    modo = sys.argv[3] if len(sys.argv) > 3 else 'A'
    os.makedirs(dst_dir, exist_ok=True)

    videos = sorted(f for f in os.listdir(src_dir) if f.lower().endswith('.mp4'))
    pendentes = [f for f in videos if not os.path.exists(os.path.join(dst_dir, f))]
    print(f'{len(videos)} video(s) na pasta, {len(pendentes)} pendente(s).', flush=True)

    for i, nome in enumerate(pendentes, 1):
        src = os.path.join(src_dir, nome)
        dst = os.path.join(dst_dir, nome)
        tmp = dst + '.tmp.mp4'
        print(f'\n=== [{i}/{len(pendentes)}] {nome} ===', flush=True)
        t0 = time.time()
        r = subprocess.run([sys.executable, SCRIPT, src, tmp, modo])
        if r.returncode == 0 and os.path.exists(tmp):
            os.replace(tmp, dst)
            print(f'OK em {time.time() - t0:.0f}s', flush=True)
        else:
            print(f'FALHOU (codigo {r.returncode}) - ver log acima. Pulando.', flush=True)
            if os.path.exists(tmp):
                os.remove(tmp)

    print('\nConcluido.', flush=True)

if __name__ == '__main__':
    main()
