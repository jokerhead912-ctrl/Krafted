#!/usr/bin/env python3
"""Measure where the bytes in a .kpak actually go.

Two container formats exist:
  buildKpakStream / buildKpakBlob -> standard ZIP  (starts with PK 03 04)
  buildKpakV6                     -> custom: [u32 size][manifest.json][media...][index]

Both put manifest.json first, so the manifest size is exact in either case.
That number is the whole point: a healthy manifest is a few hundred KB. If it
is hundreds of MB, media is being embedded as base64 inside it AND written
again as a zip entry.
"""
import sys
import os
import json
import struct
import zipfile

PK_SIG = bytes([0x50, 0x4B, 0x03, 0x04])


def fmt(b):
    if b >= (1 << 20):
        return "%.1f MB" % (b / (1 << 20))
    if b >= (1 << 10):
        return "%.0f KB" % (b / (1 << 10))
    return "%d B" % b


def read_manifest_zip(path):
    with zipfile.ZipFile(path) as z:
        manifest_bytes = 0
        media_bytes = 0
        media_count = 0
        other = 0
        for i in z.infolist():
            if i.filename == 'manifest.json':
                manifest_bytes = i.file_size
            elif i.filename.startswith('media/'):
                media_bytes += i.file_size
                media_count += 1
            else:
                other += i.file_size
        data = z.read('manifest.json')
    return data, manifest_bytes, media_bytes, media_count, other


def read_manifest_v6(path):
    with open(path, 'rb') as f:
        head = f.read(4)
        msize = struct.unpack('<I', head)[0]
        data = f.read(msize)
    total = os.path.getsize(path)
    # Tail index size is unknown without parsing it; report media as the
    # remainder and say so rather than pretending to be exact.
    return data, msize, total - 4 - msize, -1, 0


def scan_embedded(m):
    """Add up every base64 payload hiding inside the manifest."""
    out = {
        'src_dataurl': 0, 'src_dataurl_n': 0,
        'mask_brush': 0, 'mask_brush_n': 0,
        'anno_snapshot': 0, 'anno_snapshot_n': 0,
        'mindmap_img': 0, 'mindmap_audio': 0, 'mindmap_n': 0,
        'view_thumb': 0, 'view_thumb_n': 0,
        'items_total': 0, 'items_with_masks': 0,
    }
    for it in (m.get('items') or []):
        out['items_total'] += 1
        s = it.get('src') or ''
        if isinstance(s, str) and s.startswith('data:'):
            out['src_dataurl'] += len(s)
            out['src_dataurl_n'] += 1
        masks = it.get('masks') or []
        if masks:
            out['items_with_masks'] += 1
        for mk in masks:
            bd = mk.get('brushData') or ''
            if bd:
                out['mask_brush'] += len(bd)
                out['mask_brush_n'] += 1
        anno = it.get('anno') or {}
        for c in (anno.get('comments') or []):
            sn = c.get('snapshot') or ''
            if sn:
                out['anno_snapshot'] += len(sn)
                out['anno_snapshot_n'] += 1
    for mm in (m.get('mindmaps') or []):
        for n in (mm.get('nodes') or []):
            if n.get('img'):
                out['mindmap_img'] += len(n['img'])
                out['mindmap_n'] += 1
            if n.get('audio'):
                out['mindmap_audio'] += len(n['audio'])
    for v in (m.get('views') or []):
        for key in ('thumb', 'thumbnail', 'snapshot', 'img'):
            t = v.get(key) or ''
            if isinstance(t, str) and t.startswith('data:'):
                out['view_thumb'] += len(t)
                out['view_thumb_n'] += 1
                break
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: analyze_kpak_size.py <board.kpak>")
        return 2
    path = sys.argv[1]
    if not os.path.isfile(path):
        print("not a file: " + path)
        return 2

    total = os.path.getsize(path)
    with open(path, 'rb') as f:
        sig = f.read(4)
    is_zip = (sig == PK_SIG)

    print("file        : %s" % path)
    print("total size  : %s" % fmt(total))
    print("container   : %s" % ("standard ZIP" if is_zip else "v6 custom"))
    print()

    if is_zip:
        data, msize, media, mcount, other = read_manifest_zip(path)
    else:
        data, msize, media, mcount, other = read_manifest_v6(path)

    print("manifest.json : %s   (%.1f%% of file)" % (fmt(msize), 100.0 * msize / max(1, total)))
    print("media payload : %s%s" % (fmt(media), ("" if mcount < 0 else "   across %d entries" % mcount)))
    if other:
        print("other         : %s" % fmt(other))
    print()

    # A healthy manifest is structural metadata: a few hundred KB at most
    # even for a 300-image board. Anything past ~5 MB means something is
    # being embedded that should be a zip entry.
    if msize > 5 * (1 << 20):
        print("*** MANIFEST IS %s - media is embedded as base64 inside it. ***" % fmt(msize))
        print()

    try:
        m = json.loads(data.decode('utf-8'))
    except Exception as e:
        print("could not parse manifest.json: %s" % e)
        return 1

    e = scan_embedded(m)
    print("--- base64 embedded inside manifest.json ---")
    rows = [
        ("item.src as data: URL", e['src_dataurl'], e['src_dataurl_n']),
        ("masks[].brushData", e['mask_brush'], e['mask_brush_n']),
        ("anno comments[].snapshot", e['anno_snapshot'], e['anno_snapshot_n']),
        ("mindmap node img", e['mindmap_img'], e['mindmap_n']),
        ("mindmap node audio", e['mindmap_audio'], 0),
        ("view thumbnail", e['view_thumb'], e['view_thumb_n']),
    ]
    biggest = 0
    biggest_name = ""
    for name, b, n in rows:
        if b == 0:
            continue
        print("  %-28s %10s   (%d)" % (name, fmt(b), n))
        if b > biggest:
            biggest = b
            biggest_name = name
    embedded_total = sum(r[1] for r in rows)
    print("  %-28s %10s" % ("TOTAL embedded", fmt(embedded_total)))
    print()
    print("items on board : %d" % e['items_total'])
    print("items w/ masks : %d" % e['items_with_masks'])
    print()

    print("--- verdict ---")
    if e['src_dataurl'] > 0:
        dup = e['src_dataurl_n']
        print("  BUG A: %d item(s) store src as a data: URL." % dup)
        print("         Each is written TWICE: once as base64 inside")
        print("         manifest.json, once as a decoded media entry.")
        print("         Cost = 1.33x the base64 + 1x the entry, for one image.")
        print("         Crop and GIF-trim both produce this state.")
    if e['mask_brush'] > (20 << 20):
        print("  BUG B: brushData holds %s of base64 PNG." % fmt(e['mask_brush']))
        print("         The brush canvas is sized from the on-screen rect, so a")
        print("         mask painted while zoomed in stores a huge PNG.")
    if e['src_dataurl'] == 0 and e['mask_brush'] < (20 << 20):
        print("  No embedded media found. Manifest is %s." % fmt(msize))
        print("  If the file is still larger than the source images, the")
        print("  growth is in the media entries themselves -- compare the")
        print("  'media payload' line against the bytes you imported.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
