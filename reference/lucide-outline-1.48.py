#!/usr/bin/env python3
"""Draws every icon in the Lucide Icon script as a filled outline in a Pen library.

Run from docs/design, with the icon table, a template library and the output library:

    python3 -I lucide-outline.py scripts/lucide-icon.js lucide.lib.pen lucide-all.lib.pen

Why outlines: a Pen path keeps its stroke width in points however large the node is,
so a stroked icon gets lighter as it grows. A filled outline scales its weight with it.

How: each icon's path (Lucide 1.48.0: 24 x 24 grid, stroke 2, round caps and joins)
becomes cubic Beziers, CoreGraphics (the stroker macOS itself uses) strokes it, and the
outline is written as one filled path. The output keeps the template's script node and
variables, and adds one reusable component per icon (named and identified by its Lucide
name, alphabetical, in a grid) plus this note. Needs macOS with swiftc.
"""
import json, math, re, subprocess, sys, tempfile, uuid
from pathlib import Path

WIDTH = 2  # Lucide's stroke width, in 24 x 24 grid units
COLUMNS, PITCH = 40, 48  # the grid: one icon every 48 points, 40 to a row
NOTE_WIDTH, NOTE_HEADER, NOTE_LINE = 960, 80, 21  # a note: width, title bar, line height

STROKER = r"""
import Foundation
import CoreGraphics

// CoreGraphics approximates curve offsets to a fixed tolerance in its own units,
// so stroke K times larger than needed and scale the result back down.
let K: CGFloat = 64
let width = CGFloat(Double(CommandLine.arguments[2])!) * K

func num(_ v: CGFloat) -> String {
  var s = String(format: "%.3f", (Double(v / K) * 1000).rounded() / 1000)
  while s.hasSuffix("0") { s.removeLast() }
  if s.hasSuffix(".") { s.removeLast() }
  return s == "-0" ? "0" : s
}
func pt(_ p: CGPoint) -> String { num(p.x) + " " + num(p.y) }

let rows = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
for row in rows.split(separator: "\n") {
  // name, then absolute M/L/C/Z commands
  let t = row.split(separator: " ").map(String.init)
  let path = CGMutablePath()
  var i = 1
  func next() -> CGPoint {
    i += 2
    return CGPoint(x: Double(t[i - 2])! * Double(K), y: Double(t[i - 1])! * Double(K))
  }
  while i < t.count {
    i += 1
    switch t[i - 1] {
    case "M": path.move(to: next())
    case "L": path.addLine(to: next())
    case "C":
      let a = next(), b = next(), c = next()
      path.addCurve(to: c, control1: a, control2: b)
    case "Z": path.closeSubpath()
    default: fatalError("unknown command in \(t[0])")
    }
  }
  var d = ""
  path.copy(strokingWithWidth: width, lineCap: .round, lineJoin: .round, miterLimit: 10)
    .applyWithBlock { e in
      let p = e.pointee.points
      switch e.pointee.type {
      case .moveToPoint: d += "M" + pt(p[0])
      case .addLineToPoint: d += "L" + pt(p[0])
      case .addQuadCurveToPoint: d += "Q" + pt(p[0]) + " " + pt(p[1])
      case .addCurveToPoint: d += "C" + pt(p[0]) + " " + pt(p[1]) + " " + pt(p[2])
      case .closeSubpath: d += "Z"
      @unknown default: break
      }
    }
  print(t[0] + "\t" + d)
}
"""


def arc(x1, y1, rx, ry, phi, fa, fs, x2, y2):
    """An SVG elliptical arc as cubic Beziers of at most 45 degrees each (SVG spec F.6)."""
    if (x1, y1) == (x2, y2):
        return []
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [("L", x2, y2)]
    c, s = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    xp, yp = c * dx + s * dy, -s * dx + c * dy  # the half-chord, in the ellipse's own axes
    lam = xp * xp / (rx * rx) + yp * yp / (ry * ry)
    if lam > 1:  # radii too small to span the chord: grow them until they do
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    den = rx * rx * yp * yp + ry * ry * xp * xp
    co = math.sqrt(max(0, num / den)) if den else 0
    if fa == fs:
        co = -co
    cxp, cyp = co * rx * yp / ry, -co * ry * xp / rx  # centre, in the ellipse's own axes
    cx = c * cxp - s * cyp + (x1 + x2) / 2
    cy = s * cxp + c * cyp + (y1 + y2) / 2
    angle = lambda ux, uy, vx, vy: math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    ux, uy = (xp - cxp) / rx, (yp - cyp) / ry
    vx, vy = (-xp - cxp) / rx, (-yp - cyp) / ry
    start, sweep = angle(1, 0, ux, uy), angle(ux, uy, vx, vy)
    if not fs and sweep > 0:
        sweep -= 2 * math.pi
    elif fs and sweep < 0:
        sweep += 2 * math.pi
    n = max(1, math.ceil(abs(sweep) / (math.pi / 4) - 1e-9))
    P = lambda u, v: (cx + c * rx * u - s * ry * v, cy + s * rx * u + c * ry * v)
    out = []
    for i in range(n):
        a1, a2 = start + sweep * i / n, start + sweep * (i + 1) / n
        k = 4 / 3 * math.tan((a2 - a1) / 4)
        p1 = P(math.cos(a1) - k * math.sin(a1), math.sin(a1) + k * math.cos(a1))
        p2 = P(math.cos(a2) + k * math.sin(a2), math.sin(a2) - k * math.cos(a2))
        end = P(math.cos(a2), math.sin(a2)) if i < n - 1 else (x2, y2)
        out.append(("C", *p1, *p2, *end))
    return out


def to_cubics(d):
    """An SVG path (any of MLHVCSQTAZ, either case) as absolute M, L, C and Z commands."""
    t = re.findall(r"[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?", d)
    out, i, cmd = [], 0, ""
    x = y = sx = sy = 0.0  # the pen, and where the current subpath started
    lc = lq = None  # the last cubic / quadratic control point, for S and T

    def num():
        nonlocal i
        i += 1
        return float(t[i - 1])

    while i < len(t):
        if t[i].isalpha():
            cmd, i = t[i], i + 1
        rel, C = cmd.islower(), cmd.upper()
        ox, oy = (x, y) if rel else (0, 0)
        if C == "Z":
            out.append(("Z",))
            x, y, lc, lq = sx, sy, None, None
        elif C in "ML":
            x, y = ox + num(), oy + num()
            out.append((C, x, y))
            if C == "M":
                sx, sy, cmd = x, y, "l" if rel else "L"  # extra pairs after M are lines
            lc = lq = None
        elif C in "HV":
            if C == "H":
                x = (x if rel else 0) + num()
            else:
                y = (y if rel else 0) + num()
            out.append(("L", x, y))
            lc = lq = None
        elif C in "CS":
            if C == "C":
                c1 = (ox + num(), oy + num())
            else:  # S: the first control point mirrors the last one
                c1 = (2 * x - lc[0], 2 * y - lc[1]) if lc else (x, y)
            c2 = (ox + num(), oy + num())
            end = (ox + num(), oy + num())
            out.append(("C", *c1, *c2, *end))
            lc, lq, (x, y) = c2, None, end
        elif C in "QT":
            if C == "Q":
                q = (ox + num(), oy + num())
            else:  # T: the control point mirrors the last one
                q = (2 * x - lq[0], 2 * y - lq[1]) if lq else (x, y)
            end = (ox + num(), oy + num())
            # the quadratic, as the cubic with the same shape
            out.append(("C", x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y),
                        end[0] + 2 / 3 * (q[0] - end[0]),
                        end[1] + 2 / 3 * (q[1] - end[1]), *end))
            lc, lq, (x, y) = None, q, end
        elif C == "A":
            rx, ry, phi, fa, fs = num(), num(), num(), num(), num()
            assert fa in (0, 1) and fs in (0, 1), f"arc flags in {d}"
            end = (ox + num(), oy + num())
            out += arc(x, y, rx, ry, phi, fa, fs, *end)
            x, y, lc, lq = end[0], end[1], None, None
        else:
            raise ValueError(f"unsupported command {cmd} in {d}")
    return out


def drop_empty_contours(d):
    """Where an offset collapses (a circle of radius 1 has no inside left) CoreGraphics
    leaves a contour with no area. It does no harm, but there is no reason to keep it."""
    def area(sub):
        v = [float(n) for n in re.findall(r"-?\d+\.?\d*", sub)]
        pts = list(zip(v[0::2], v[1::2]))
        shifted = pts[1:] + pts[:1]
        return sum(a * d - c * b for (a, b), (c, d) in zip(pts, shifted)) / 2
    return "".join(s for s in re.findall(r"M[^M]*", d) if abs(area(s)) > 1e-3)


def main(table_js, template_pen, out_pen):
    source = Path(table_js).read_text()
    table = re.search(r"const ICONS = `\n(.*?)`;", source, re.S).group(1)
    icons = {}
    for row in table.splitlines():
        name, shape = row.split(" ", 1)
        stroked, _, filled = shape.partition("|")
        # The only filled parts are dots of radius 1 or less, which a stroke of 2
        # already covers, so they add nothing.
        assert all(float(r) <= WIDTH / 2 for r in re.findall(r"a([\d.]+) ", filled)), name
        icons[name] = stroked
    names = sorted(icons)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        swift, binary, rows = tmp / "stroke.swift", tmp / "stroke", tmp / "icons.txt"
        swift.write_text(STROKER)
        rows.write_text("".join(
            n + " " + " ".join(c[0] + "".join(" " + repr(round(v, 9)) for v in c[1:])
                               for c in to_cubics(icons[n])) + "\n" for n in names))
        subprocess.run(["swiftc", "-O", "-o", str(binary), str(swift)], check=True)
        done = subprocess.run([str(binary), str(rows), str(WIDTH)],
                              check=True, capture_output=True, text=True)
    outlines = dict(line.split("\t") for line in done.stdout.splitlines())
    assert sorted(outlines) == names

    doc = json.loads(Path(template_pen).read_text())
    doc["children"] = [c for c in doc["children"] if c["type"] == "script"]
    for k, name in enumerate(names):
        doc["children"].append({
            "type": "path", "id": name, "name": name, "reusable": True,
            "x": k % COLUMNS * PITCH, "y": k // COLUMNS * PITCH, "width": 24, "height": 24,
            "viewBox": [0, 0, 24, 24], "fill": "$doc-text",
            "geometry": drop_empty_contours(outlines[name])})
    note = Path(__file__).read_text()
    doc["children"].append({
        "type": "note", "id": "generator-script", "name": "Generator script",
        "x": -NOTE_WIDTH - PITCH, "y": 0, "width": NOTE_WIDTH,
        "height": NOTE_HEADER + NOTE_LINE * note.count("\n"), "content": note})
    doc["fileToken"] = str(uuid.uuid4())
    Path(out_pen).write_text(json.dumps(doc, indent=2) + "\n")
    print(f"{len(names)} icons -> {out_pen}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
