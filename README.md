# img2svg

A Figma plugin that traces raster images (PNG/JPG) into editable SVG vectors directly on the canvas.

## Features

- Select one or more image layers and convert them to vector paths
- Live preview as you adjust tracing parameters
- Controls for shape (despeckle, corner smoothing, curve optimization), turn policy, and color (posterization, color extraction, monochrome path mode)
- Traced SVGs replace the original images in-place, preserving position and size
- Cancel or close the plugin window to revert all changes

## Getting started

```sh
npm install
npm run build
```

Load the plugin in Figma via **Plugins > Development > Import plugin from manifest...** and select `manifest.json`.

For development with live reload:

```sh
npm run watch
```

## Usage

1. Select one or more layers that contain an image fill
2. Run the plugin
3. Adjust tracing options -- the canvas updates live
4. Click **Apply** to commit, or **Cancel** / close the window to revert

## License

GPL-2.0
