# Atom Studio

Atom Studio is a browser editor for drawing 3D atomic structure diagrams. A new workspace starts empty.

## Run locally

Use Node.js 22.13 or newer and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open [Atom Studio on localhost](http://127.0.0.1:5200/) in a browser with WebGL support. `pnpm test` runs the editor tests. The `dist/` output can also be served by a static web host.

## Edit and export

- Build with spheres and cubes. Place objects on a grid, edit their colour and surface, repeat items across layers, and select by colour or material.
- Lock objects against edits or use linked front, top, and side views to position them. Import flat images into the 3D scene and adjust their size, position, and orientation.
- Use the material legend and export a PNG. Save an editable structure as JSON, or use **Open JSON** to load an Atom Studio structure from versions 1–7.

Browser autosave stores your workspace on this device, for the browser profile and address you use. Save a JSON copy for a portable backup. The standalone editor requires no account, ships without sample scenes, and has no server-side scene storage.
