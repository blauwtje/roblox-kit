"""The shared mesh library: geometry, materials, UV unwrapping and the bake-and-export run.

A mesh script puts the `meshes/` folder on `sys.path` and imports from these modules; it never redefines a name
they export (`mesh-library.test.ts` checks).
"""
