# E2E-labeltool

Quick, in-browser inspection of point clouds (`.pcd`/`.bin`) paired with spline trajectory editing and optimisation.

## Run locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/> in a WebGL-capable browser.

## Load data

- **Load** button: choose a point cloud and/or `.npy` trajectory.
- **Demo** button: loads the sample files configured in `config.js`.
- Control points come from `config.js -> initCtrl` once the first file loads.

## Edit & optimise

1. Explore with the Iso / Top buttons or `Space` for 2D.
2. Drag control points (in 2D: click empty space to add one).
3. Press `O` to optimise (history points stay fixed, jerk/velocity/accel are penalised).
4. Charts update live; `E` exports JSON with control points, samples `(t,x,y)`, and metadata.

## Controls

| Input | Action |
| --- | --- |
| `Space` | Toggle 2D/3D |
| `Top` / `Iso` | Camera presets |
| `Delete` / `Backspace` | Delete selected control point |
| `Z` / `Y` | Undo / Redo |
| `S` | Toggle samples & charts |
| `O` | Run optimisation |
| `L` | Open the Load dialog |
| `E` | Export JSON |
| Mouse wheel | Zoom |
| Left drag | Move control/sample points (2D click empty space to add) |
| Right drag | Pan |

Current point cloud / trajectory names are shown in the footer.

## Config

`config.js` holds defaults for point size, curve type, sample counts (`N_FUTURE`, `N_PAST`), optimisation weights, and other viewer settings.

Happy labelling!

---
_Disclaimer: this repository was created and refined with help from an AI language model._
