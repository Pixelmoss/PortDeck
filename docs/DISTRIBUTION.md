# PortDeck distribution readiness

PortDeck 1.5 contains the code and CI paths required for public macOS distribution. The remaining signing authority must come from the product owner's Apple Developer account.

## Required Apple setup

1. Join the Apple Developer Program using the legal owner or organization account.
2. Create a `Developer ID Application` certificate and export it as a password-protected `.p12` file.
3. Create an app-specific password for the Apple ID used by notarytool.
4. Add the following GitHub Actions secrets:
   - `CSC_LINK`: base64-encoded `.p12` or a secure certificate URL
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
5. Trigger the release workflow from a clean semantic-version tag.

The workflow refuses to build a public release when any credential is missing. It builds arm64, x64, and universal packages, verifies codesign, Hardened Runtime, Gatekeeper acceptance and the stapled notarization ticket, and publishes an SBOM with the artifacts.

## Privacy defaults

- Crash diagnostics are disabled by default.
- Users must explicitly enable local crash diagnostics in Settings.
- Crash files and exported diagnostics are never uploaded automatically.
- Update checks request only GitHub's public latest-release metadata.

## Public launch checklist

- Confirm the GitHub support channel and add a dedicated support mailbox when one is available.
- Publish the privacy and support pages under the official domain.
- Confirm both Apple Silicon and Intel launch tests on physical Macs.
- Verify update discovery from the previous signed version.
- Preserve the generated manifest, SBOM, notarization log and release checksums.
