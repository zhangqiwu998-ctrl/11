#!/usr/bin/env python3
"""Build a self-contained two-clip A/B test; never modify source videos."""
import json, math, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "hls-site" / "media"
OUT.mkdir(parents=True, exist_ok=True)
clips = [(str(p.relative_to(ROOT / "assets" / "films").with_suffix("")), str(p.relative_to(ROOT)), None) for p in sorted((ROOT / "assets" / "films").rglob("*.mp4"))]
assert len(clips) == 13, f"Expected 13 source clips, got {len(clips)}"
tiers = [(360, 450), (540, 850), (720, 1600), (1080, 3000)]

def run(args, cwd=None):
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)

def probe(path):
    return json.loads(subprocess.check_output(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)]))

def dimensions(path):
    data=probe(path)
    v=next(s for s in data["streams"] if s["codec_type"]=="video")
    return v["width"],v["height"]

def segments(folder):
    lines=(folder/"index.m3u8").read_text().splitlines()
    durations=[]; names=[]
    for line in lines:
        if line.startswith("#EXTINF:"):
            durations.append(float(line.split(":")[1].split(",")[0]))
        elif line and not line.startswith("#"):
            names.append(line)
    assert "#EXT-X-ENDLIST" in lines and len(durations)==len(names) and names
    sizes=[(folder/n).stat().st_size for n in names]
    assert all(s>0 for s in sizes)
    return durations,names,sizes

summary=[]
for name,src,poster in clips:
    source=ROOT/src
    target=OUT/name
    target.mkdir(parents=True, exist_ok=True)
    w,h=dimensions(source)
    short=min(w,h)
    choices=[(p,k) for p,k in tiers if p<=short]
    if not choices:
        choices=[(short,450)]
    master=["#EXTM3U","#EXT-X-VERSION:3","#EXT-X-INDEPENDENT-SEGMENTS"]
    variants=[]
    for p,k in choices:
        folder=target/str(p)
        folder.mkdir(exist_ok=True)
        # preserve aspect ratio, orientation and source frame rate, no upscaling.
        scale=f"scale=-2:{p}" if w>=h else f"scale={p}:-2"
        run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y","-i",source,
             "-map","0:v:0","-map","0:a:0?","-vf",scale,
             "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p",
             "-b:v",f"{k}k","-maxrate",f"{int(k*1.25)}k","-bufsize",f"{k*2}k",
             "-sc_threshold","0","-flags","+cgop","-force_key_frames","expr:gte(t,n_forced*2)",
             "-c:a","aac","-b:a","96k","-f","hls","-hls_time","2",
             "-hls_playlist_type","vod","-hls_flags","independent_segments",
             "-hls_segment_filename","seg_%04d.ts","index.m3u8"],cwd=folder)
        durations,names,sizes=segments(folder)
        vw,vh=dimensions(folder/names[0])
        assert min(vw,vh)<=short
        for segment in names:
            packets=json.loads(subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0","-show_packets","-show_entries","packet=flags","-of","json",str(folder/segment)]))["packets"]
            assert packets and "K" in packets[0]["flags"], f"non-keyframe segment: {segment}"
        # Measure delivered peak and average bitrate, not just encoder targets.
        peak=math.ceil(max(8*s/d for s,d in zip(sizes,durations))*1.10)
        avg=math.ceil(8*sum(sizes)/sum(durations))
        master.extend([f"#EXT-X-STREAM-INF:BANDWIDTH={max(peak,avg)},AVERAGE-BANDWIDTH={avg},RESOLUTION={vw}x{vh}",f"{p}/index.m3u8"])
        variants.append({"short_edge":p,"resolution":f"{vw}x{vh}","segments":len(names),"seconds":round(sum(durations),3),"bytes":sum(sizes),"first_segment_bytes":sizes[0],"peak_bps":peak})
        if len(variants)>1:
            assert abs(variants[-1]["seconds"]-variants[0]["seconds"])<0.15,"unaligned duration"
    (target/"master.m3u8").write_text("\n".join(master)+"\n")
    # Decode every rendition to detect bad media, not only playlist syntax.
    for v in variants:
        run(["ffmpeg","-v","error","-xerror","-nostdin","-i",target/str(v["short_edge"])/"index.m3u8","-f","null","-"])
    summary.append({"clip":name,"original_bytes":source.stat().st_size,"variants":variants})
(OUT/"encoding-report.json").write_text(json.dumps(summary,indent=2))
print(json.dumps(summary,indent=2))
