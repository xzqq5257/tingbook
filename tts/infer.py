#!/usr/bin/env python3
"""Clone the wuyongss voice with F5-TTS and synthesize real, intelligible speech.

Usage:
  python infer.py --ref wuyongss.wav --text "要朗读的文字" --out out.wav
"""
import argparse, os

CKPT_DEFAULT = os.path.join(os.path.dirname(__file__), "..", "tts_models", "F5TTS_Base", "F5TTS_Base", "model_1200000.pt")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="reference voice wav (wuyongss.wav)")
    ap.add_argument("--text", required=True, help="text to synthesize")
    ap.add_argument("--ref_text", default="", help="transcript of the reference audio (improves cloning)")
    ap.add_argument("--out", required=True, help="output wav path")
    ap.add_argument("--ckpt", default=CKPT_DEFAULT)
    ap.add_argument("--nfe_step", type=int, default=32)
    ap.add_argument("--device", default="cuda" if _cuda() else "cpu")
    args = ap.parse_args()

    from f5_tts.api import F5TTS
    model = F5TTS(model_type="F5TTS_Base", ckpt_file=args.ckpt,
                  vocoder_name="vocos", device=args.device)
    wav, sr, _ = model.infer(ref_audio=args.ref, ref_text=args.ref_text,
                             gen_text=args.text, nfe_step=args.nfe_step, speed=1.0)
    import soundfile as sf
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sf.write(args.out, wav, sr)
    print("saved", args.out, os.path.getsize(args.out), "bytes")

def _cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False

if __name__ == "__main__":
    main()
