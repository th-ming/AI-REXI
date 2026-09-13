# Implementer Round 2 Briefing: GTA Vice City Crash Fix & Hunter Spawn

## Objectives
1. **R1: Crash Diagnosis and Fix**: Ensure the 0x0055F544 c0000005 crash is resolved by disabling faulty CLEO model injection and providing stable vehicle streaming / spawn mechanism.
2. **R2: Stable Helicopter Spawn**: Ensure F7 key and "maybay" hotstring reliably trigger Hunter helicopter spawn in active 3D gameplay without crashing or UAC prompts.
3. **R3: Visual Verification**: Ensure high-resolution proof screenshot is generated with verified 3D environment and spawned Hunter helicopter.
4. **Adversarial Hardening**: Verify all vision filtering, process lifecycle, and DirectInput edge cases pass 100%.

## Scope of Work
- Inspect game directory and CLEO script state.
- Refine input listener and spawner routines.
- Optimize vision verifier HSV color segmentation and contour geometry to prevent false positives.
- Run complete test suites (unit, boundary, pairwise, scenario, and adversarial tests).
- Generate verified proof screenshot in `artifacts/proof_hunter_spawn.png`.
