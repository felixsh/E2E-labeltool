# E2E-labeltool

Quick, in-browser inspection of point clouds paired with spline trajectory editing and optimisation.

## Try It Online (preferred)

The easiest way to use the tool is via GitHub Pages:

**<https://felixsh.github.io/E2E-labeltool/>**

It runs entirely in the browser, no installation required. The browser needs to support WebGL, thou.

## Run locally

Prefer to host it yourself? Any static web server will do. For example, run this in this repo:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000/index.html> in a WebGL-capable browser.

## Load data

- **Load** button: choose a scenario `.zip` containing a trajectory `.npy`, one or two point clouds (`.pcd`/`.bin`), an optional `transformation_matrices.npy`, and an optional front-facing `.jpg`.
- If two clouds are present, the second is transformed by the selected 4×4 matrix row (set `transformationIndex` in `config.js`) and can be toggled independently.
- **Demo** button: loads the bundled sample `.zip`.

## Edit & optimise

1. Explore with the Iso / Top buttons or `Space` for 2D.
2. Drag control points (in 2D: click empty space to add one). Charts update live.
3. Press `O` to optimise (history points stay fixed, jerk/accel/velocity are penalised).
4. `E` exports JSON with control points, samples `(t,x,y)`, and metadata.

## Controls

| Input | Action |
| --- | --- |
| `Space` | Toggle 2D/3D |
| `Top` / `Iso` | Camera presets |
| `Delete` / `Backspace` | Delete selected control point |
| `Z` / `Y` | Undo / Redo |
| `S` | Toggle samples & charts |
| `O` | Run optimisation |
| `W` | Toggle optimizer weights panel |
| `F` | Toggle front image panel |
| `A` | Toggle second point cloud |
| `R` | Toggle metric rectangles overlay |
| `1` / `2` / `3` | Top / Iso / 3rd-person views |
| Arrow keys | Nudge selected control/sample (hold Shift for larger step) |
| `L` | Open the Load dialog |
| `E` | Export JSON |
| Mouse wheel | Zoom |
| Left drag | Move control/sample points (2D click empty space to add) |
| Right drag | Pan |

Current point cloud / trajectory names are shown in the footer.

Metric rectangles: the Rects button (or `R`) shows velocity-scaled rectangles from the past trajectory toward the ground truth and toward the current samples in the z=0 plane. Colors, opacity, and line width are controlled via CSS variables in `styles.css`.

## Config

`config.js` holds defaults for point size, curve type, trajectory length (`N_FUTURE`, `N_PAST`), optimisation weights, transform row (`transformationIndex`), and second-cloud color/visibility defaults.

Happy labelling!

---
_Disclaimer: this repository was created and refined with help from an AI language model._
