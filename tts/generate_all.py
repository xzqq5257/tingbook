#!/usr/bin/env python3
"""Batch-clone the wuyongss voice across the whole library.

Reads the BOOKS array from ../index.html, plus the 葬花吟 poem, and synthesizes
real speech for every entry using F5-TTS, overwriting audio/*.mp3 and
listen-to-your-voice/ltyv_read_zanghuayin.wav.
"""
import argparse, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
INDEX = os.path.join(REPO, "index.html")
AUDIO = os.path.join(REPO, "audio")
LTYV = os.path.join(REPO, "listen-to-your-voice")
FFMPEG = ""  # set if ffmpeg not on PATH; auto-falls back to imageio-ffmpeg if missing
CKPT = os.path.join(HERE, "..", "tts_models", "F5TTS_Base", "F5TTS_Base", "model_1200000.pt")
ZH = "花谢花飞花满天，红消香断有谁怜。游丝软系飘春榭，落絮轻沾扑绣帘。闺中女儿惜春暮，愁绪满怀无释处。手把花锄出绣帘，忍踏落花来复去。柳丝榆荚自芳菲，不管桃飘与李飞。桃李明年能再发，明年闺中知有谁？三月香巢已垒成，梁间燕子太无情！明年花发虽可啄，却不道人去梁空巢也倾。一年三百六十日，风刀霜剑严相逼。明媚鲜妍能几时，一朝飘泊难寻觅。花开易见落难寻，阶前闷杀葬花人。独倚花锄泪暗洒，洒上空枝见血痕。杜鹃无语正黄昏，荷锄归去掩重门。青灯照壁人初睡，冷雨敲窗被未温。怪奴底事倍伤神，半为怜春半恼春。怜春忽至恼忽去，至又无言去不闻。昨宵庭外悲歌发，知是花魂与鸟魂？花魂鸟魂总难留，鸟自无言花自羞。愿奴胁下生双翼，随花飞到天尽头！天尽头，何处有香丘？未若锦囊收艳骨，一抔净土掩风流。质本洁来还洁去，强于污淖陷渠沟。尔今死去侬收葬，未卜侬身何日丧？侬今葬花人笑痴，他年葬侬知是谁？试看春残花渐落，便是红颜老死时。一朝春尽红颜老，花落人亡两不知！"

def parse_books():
    html = open(INDEX, encoding="utf-8").read()
    pat = re.compile(r'title:"((?:[^"\\]|\\.)*)"\s*,\s*duration:\s*\d+\s*,\s*text:"((?:[^"\\]|\\.)*)"\s*,\s*file:"(audio/[^"]+)"', re.S)
    out = []
    for m in pat.finditer(html):
        title = m.group(1).encode().decode("unicode_escape")
        text = m.group(2).encode().decode("unicode_escape").replace("\\n", "，").replace("\n", "，")
        text = re.sub(r'\s+', '，', text)
        out.append((title, text, m.group(3)))
    return out

def _ffmpeg_exe():
    if FFMPEG:
        return FFMPEG
    import shutil
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"  # last resort; will fail loudly if truly absent

def to_mp3(wav, mp3, br="64k"):
    exe = _ffmpeg_exe()
    subprocess.run([exe, "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", br, mp3],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default=os.path.join(LTYV, "ltyv_reference.wav"),
                    help="reference voice wav (default: repo's listen-to-your-voice/ltyv_reference.wav)")
    ap.add_argument("--ref_text", default="", help="transcript of reference audio")
    ap.add_argument("--nfe_step", type=int, default=32)
    args = ap.parse_args()

    from f5_tts.api import F5TTS
    import soundfile as sf
    device = "cuda" if _cuda() else "cpu"
    print("device:", device)
    model = F5TTS(model_type="F5TTS_Base", ckpt_file=CKPT, vocoder_name="vocos", device=device)
    os.makedirs(AUDIO, exist_ok=True)
    os.makedirs(LTYV, exist_ok=True)

    # 葬花吟
    zwav = os.path.join(LTYV, "ltyv_read_zanghuayin.wav")
    print(">> 葬花吟")
    wav, sr, _ = model.infer(ref_audio=args.ref, ref_text=args.ref_text, gen_text=ZH, nfe_step=args.nfe_step)
    sf.write(zwav, wav, sr)
    print("   ", zwav, os.path.getsize(zwav))

    # 23 books
    books = parse_books()
    print(f">> {len(books)} books")
    for i, (title, text, fname) in enumerate(books, 1):
        mp3 = os.path.join(REPO, fname)
        tmp = os.path.join(AUDIO, f"_tmp_{i}.wav")
        print(f"[{i}/{len(books)}] {title}")
        wav, sr, _ = model.infer(ref_audio=args.ref, ref_text=args.ref_text, gen_text=text, nfe_step=args.nfe_step)
        sf.write(tmp, wav, sr)
        to_mp3(tmp, mp3)
        os.remove(tmp)
    print("DONE")

def _cuda():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False

if __name__ == "__main__":
    main()
