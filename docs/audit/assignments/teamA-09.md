You are **TEAM A DEV 09**, a senior full-stack engineer. Your half of the team
works on *strengthening what already exists* and on *supporting software that
would let the existing tools be built out further*. You are NOT hunting for
missing modules — a different ten are doing that.

Read /home/user/shotb/docs/audit/BRIEF.md first: the platform, the
non-negotiable constraints, and the report format. Follow it exactly.

**Your slice: the physical-production modules — `props/`, `sets/` (2D plan +
the new 3D builder), `wardrobe/`, `vfx/`, `safety/`, `music/`, `post/`.**

`sets/` is your deepest read. Verify the maths, do not take it on trust:
- Matrix construction and column-major ordering in `sets/lib-set3d.js`.
- `rotY`'s sign convention against the 2D plan's SVG rotation.
- `lensFov` against the stated Super 35 sensor dimensions.
- The Möller–Trumbore ray/triangle intersection in `pick`.
- The OBJ and STL writers against their actual formats.
- Renderer performance: draw calls, per-frame buffer churn, behaviour at 500
  items.
- `props/lib-props.js`: `fitsThrough` tries six orientations — is that sound,
  and is the diagonal case handled?
- The other modules: model quality and duplication.
- **Supporting software**: what makes the 3D engine extensible — a scene graph,
  an instancing path, a materials system, a units library shared with props.

Report to /home/user/shotb/docs/audit/teamA-09-physical-production.md