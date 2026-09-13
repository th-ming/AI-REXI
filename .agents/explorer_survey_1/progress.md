# Progress Log - Survey Explorer 1

Last visited: 2026-08-28T03:28:00Z

## Status
- [x] Initialized DISPATCH.md and BRIEFING.md
- [x] Task 1: Inspect game installation directory `D:\Games\Grand Theft Auto Vice City` (files, executables, DLLs, CLEO, wrappers)
- [x] Task 2: Inspect user files `%USERPROFILE%\Documents\GTA Vice City User Files` (saves, gta_vc.set)
- [x] Task 3: Investigate 0xC0000005 crash factors, DEP, multi-core affinity, DirectPlay, resolution, registry
- [x] Task 4: Inspect custom scripts, trainers, cheat handlers (F7, maybay, CLEO)
- [x] Task 5: Synthesize and compile authoritative handoff.md and send completion message

## Summary of Findings
- Clean binary: GTA Vice City 1.0 US No-CD (`gta-vc.exe`, SHA256 `04e4db72...`)
- SilentPatch v1.1 Build 32 + D3D8to9 wrapper (`d3d8.dll`) installed
- Zero-crash launch: Launch with `__COMPAT_LAYER = "RunAsInvoker"` (Do NOT use WinXP compatibility mode)
- Video bypass: Intro MPGs renamed to `.bak`
- Helicopter spawn: `CLEO\F7_Hunter.cs` triggers on VK_F7 (118) to spawn Hunter 8m in front of Tommy Vercetti
- UIPI / UAC: Manifest has `level="asInvoker"`, ensuring full input automation compatibility.
