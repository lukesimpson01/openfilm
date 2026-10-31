# Third-party notices

Studio's editor (`studio/ui/dist`) bundles:

- **Inter** by Rasmus Andersson, via `@fontsource-variable/inter`: SIL Open Font License 1.1
  (https://openfontlicense.org).
- **React** and **React DOM**: MIT License, © Meta Platforms, Inc. and affiliates.
- **Lucide** icons (`lucide-react`): ISC License, © Lucide Contributors.

The CLI depends on **playwright-core** (Apache License 2.0), which downloads a headless Chromium on first use.

The Shorts editor additions also ship, loaded only when used (`studio/ui/public/assets/vendor`):

- **three.js** (`three.module.min.js`, `three.core.min.js`, RoundedBoxGeometry, RoomEnvironment): MIT License,
  © 2010–2026 three.js authors. Copied into a project's `frame/` folder when it has a 3D layer.
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision` 1.1.1, its WASM): Apache License 2.0, © Google LLC.
- **MediaPipe image segmenter models**: DeepLab v3 and Selfie Multiclass (256×256), from Google's MediaPipe model
  catalogue, published under the Apache License 2.0 (see their model cards). Verify the model cards before
  redistributing a modified build.
