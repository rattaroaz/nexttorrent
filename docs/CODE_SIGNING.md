# Code signing (release binaries)

Signing reduces SmartScreen / Gatekeeper warnings and proves publisher identity.

## Windows

- Obtain a **Authenticode** certificate (standard code-signing or EV for immediate SmartScreen reputation).
- Sign the built `.exe` and installer with `signtool sign` (SDK) or your CI’s signing step.
- Timestamp signatures (`/tr` HTTP RFC3161) so signatures remain valid after certificate expiry.

## macOS

- Enroll in the **Apple Developer Program**.
- Use **codesign** with a **Developer ID Application** identity for the `.app` bundle, then **notarize** with `notarytool`/`altool` and staple the ticket for offline Gatekeeper validation.

## Linux

- Distribution-specific: many communities rely on package repositories (Flatpak, distro packages) rather than a single vendor signature; follow your target channel’s guidelines.

CI should keep signing secrets (tokens, PKCS#11 PINs) in protected secret stores, never in the repository.
