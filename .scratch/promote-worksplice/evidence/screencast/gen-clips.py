import subprocess, os

S = "/tmp/shots"
FPS = 30
# (名字, 秒数, 起始 zoom, 结束 zoom, 目标点 px, py（0-1，画面注视点）, 平移 y 增量)
clips = [
    ("s01-board",            6,  1.00, 1.05, 0.50, 0.50, 0),
    ("s02-board-approve",   10,  1.05, 1.45, 0.45, 0.55, 0),
    ("s03-messages",        10,  1.12, 1.12, 0.50, 0.50, 90),
    ("s04-agent-panel",      4,  1.02, 1.08, 0.72, 0.45, 0),
    ("s04b-agent-cost",      4,  1.02, 1.08, 0.72, 0.55, 0),
    ("s05-wake",             6,  1.05, 1.14, 0.50, 0.30, 0),
    ("s05b-working1",        2,  1.06, 1.06, 0.50, 0.30, 0),
    ("s05b-working3",        2,  1.06, 1.06, 0.50, 0.30, 0),
    ("s06-interject",        6,  1.06, 1.16, 0.50, 0.35, 0),
    ("s07-revised",         14,  1.05, 1.35, 0.50, 0.40, 0),
    ("s08-session-file",    12,  1.00, 1.06, 0.50, 0.50, 0),
    ("s09-compare",         10,  1.00, 1.05, 0.50, 0.50, 0),
    ("s10-endcard",          4,  1.00, 1.00, 0.50, 0.50, 0),
]
W, H = 1600, 900
for i, (name, secs, z0, z1, px, py, pan) in enumerate(clips):
    src = f"{S}/{name}.png"
    assert os.path.exists(src), src
    frames = int(secs * FPS)
    zexpr = f"{z0}+({z1}-{z0})*on/{max(frames-1,1)}"
    xexpr = f"max(0\\,min(iw-iw/zoom\\,{px}*iw-(iw/zoom)/2))"
    yexpr = f"max(0\\,min(ih-ih/zoom\\,{py}*ih-(ih/zoom)/2+({pan})*on/{max(frames-1,1)}))"
    vf = (f"scale=3840:2160,zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}'"
          f":d={frames}:s={W}x{H}:fps={FPS},format=yuv420p")
    out = f"/tmp/vid/clip{i:02d}.mp4"
    cmd = ["ffmpeg","-y","-loglevel","error","-loop","1","-framerate",str(FPS),"-i",src,
           "-vf",vf,"-frames:v",str(frames),"-c:v","libx264","-preset","medium","-crf","20",
           "-pix_fmt","yuv420p","-r",str(FPS),out]
    subprocess.run(cmd, check=True)
    print(f"  clip{i:02d} {name} {secs}s → {os.path.getsize(out)//1024} KB")
